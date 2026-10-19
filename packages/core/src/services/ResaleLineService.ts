/**
 * LIRA-309 — phone lines the shop holds FOR SALE: their details (carrier,
 * credit, expiry). Orchestration only; all SQL lives in
 * `ResaleLineRepository` / `CarrierLineRepository` (rule 13).
 *
 * Spec: `specs/309-phone-lines-management/spec.md` (FR-001..FR-005).
 */
import {
  getResaleLineRepository,
  type ResaleLineEntity,
  type ResaleLineRepository,
  type ResaleLineRow,
} from "../repositories/ResaleLineRepository.js";
import {
  getCarrierLineRepository,
  type CarrierLineRepository,
} from "../repositories/CarrierLineRepository.js";
import {
  getExpenseRepository,
  type ExpenseRepository,
} from "../repositories/ExpenseRepository.js";
import {
  isPhoneLineCategoryName,
  isSameLebanesePhone,
} from "../utils/phoneNumber.js";
import {
  classifyLineStatus,
  RESALE_LINE_EXPIRY_WARNING_DAYS,
} from "../utils/lineStatus.js";
import {
  classifyLineValidity,
  projectValidityExpiry,
} from "../utils/carrierLineValidity.js";
import { planSmsTransfer } from "../utils/telecomCredit.js";
import { planLineGiveBack } from "../utils/lineGiveBack.js";
import {
  isLineChargeProvider,
  LINE_CHARGE_PROVIDER_ERROR,
} from "../constants/lineChargeProviders.js";
import { clientDay } from "../utils/requestDay.js";
import { inventoryLogger } from "../utils/logger.js";
import type {
  GiveBackResaleLineData,
  ListResaleLinesQuery,
  RechargeResaleLineData,
  SaveResaleLineData,
  WriteOffResaleLineData,
} from "../validators/resaleLine.js";
import type { RecordRechargeInput } from "../repositories/ResaleLineRepository.js";

/** The expense category a written-off line is booked under. */
export const LOST_PHONE_LINE_CATEGORY = "Lost phone line";

/** One message for both directions of FR-005 (a number can be a shop line
 *  or an unsold for-sale line, never both). */
export const LINE_NUMBER_TAKEN_ERROR =
  "This number is already one of your lines.";

export type ResaleLineResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** What a recharge of a line held for sale returns (LIRA-309 US3). */
export interface ResaleLineRechargeData {
  transaction_id: number;
  recharge_id: number;
  cost_usd: number;
  line: {
    cost_usd: number;
    price_usd: number;
    validity_expires_at: string | null;
    credits: number;
  };
}
export type ResaleLineRechargeResult = ResaleLineResult<ResaleLineRechargeData>;

/** What giving credit back from a line held for sale returns (LIRA-337). */
export interface ResaleLineGiveBackData {
  transaction_id: number;
  give_back_id: number;
  credits_sent: number;
  sms_fee_usd: number;
  price_drop_usd: number;
  cost_drop_usd: number;
  line: { credits: number; price_usd: number; cost_usd: number };
}
export type ResaleLineGiveBackResult = ResaleLineResult<ResaleLineGiveBackData>;

export class ResaleLineService {
  private repo: ResaleLineRepository;
  private carrierRepo: CarrierLineRepository;
  private expenseRepoRef: ExpenseRepository | null;

  constructor(
    repo?: ResaleLineRepository,
    carrierRepo?: CarrierLineRepository,
    expenseRepo?: ExpenseRepository,
  ) {
    this.repo = repo ?? getResaleLineRepository();
    this.carrierRepo = carrierRepo ?? getCarrierLineRepository();
    this.expenseRepoRef = expenseRepo ?? null;
  }

  private get expenseRepo(): ExpenseRepository {
    if (!this.expenseRepoRef) this.expenseRepoRef = getExpenseRepository();
    return this.expenseRepoRef;
  }

  /** The For sale list (and, with `include_sold: false`, the numbers the
   *  Mobile Recharge page checks typed numbers against). */
  listLines(query: ListResaleLinesQuery): ResaleLineRow[] {
    return this.repo.listLines({
      carrier: query.carrier,
      includeSold: query.include_sold,
    });
  }

  /** Create or update a for-sale line's details (admin). */
  saveDetails(input: SaveResaleLineData): ResaleLineResult<ResaleLineEntity> {
    try {
      const product = this.repo.getLineProduct(input.product_id);
      if (!product) return { success: false, error: "Product not found." };
      if (!isPhoneLineCategoryName(product.category)) {
        return {
          success: false,
          error: "Only products in a phone lines category have line details.",
        };
      }
      const taken = this.carrierRepo
        .getAllActive()
        .some((l) => isSameLebanesePhone(l.phone_number, product.barcode));
      if (taken) return { success: false, error: LINE_NUMBER_TAKEN_ERROR };

      const saved = this.repo.upsertDetails(input.product_id, {
        carrier: input.carrier,
        credits: input.credits,
        validityExpiresAt: input.validity_expires_at,
      });
      inventoryLogger.info(
        { productId: input.product_id, carrier: input.carrier },
        "For-sale line details saved",
      );
      return { success: true, data: saved };
    } catch (error) {
      inventoryLogger.error(
        { error, productId: input.product_id },
        "Failed to save for-sale line details",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Write off a LOST line held for sale (FR-016, owner decision 2026-10-11):
   * the line stays in stock with a "write off?" alert until the owner acts;
   * this books its full cost (FIFO, so any capitalized recharge included)
   * as a loss. Reuses the existing reversible stock-expense flow
   * (EXPENSE_INVENTORY) — no new money path; its void restores the stock
   * and removes the expense.
   *
   * "Lost" is judged on the shop's own day (`client_day`, rule 27).
   */
  writeOff(
    input: WriteOffResaleLineData,
    userId: number,
  ): ResaleLineResult<{ expense_id: number }> {
    try {
      const line = this.repo
        .listLines({ includeSold: false })
        .find((l) => l.product_id === input.product_id);
      if (!line) return { success: false, error: "This line is not in stock." };

      const day = input.client_day ?? clientDay();
      const status = classifyLineStatus(
        line.validity_expires_at,
        day,
        RESALE_LINE_EXPIRY_WARNING_DAYS,
      ).status;
      if (status !== "LOST") {
        return {
          success: false,
          error:
            "Only a line that is lost (expired past its grace period) can be written off.",
        };
      }

      const note = input.note?.trim();
      const expenseId = this.expenseRepo.createStockExpense(
        {
          source: "INVENTORY",
          item_id: input.product_id,
          quantity: 1,
          category: LOST_PHONE_LINE_CATEGORY,
          description: `Lost phone line ${line.phone_number ?? ""}${note ? ` — ${note}` : ""}`,
          expense_date: day,
        },
        userId,
      );
      inventoryLogger.info(
        { productId: input.product_id, expenseId },
        "Lost phone line written off",
      );
      return { success: true, data: { expense_id: expenseId } };
    } catch (error) {
      inventoryLogger.error(
        { error, productId: input.product_id },
        "Failed to write off phone line",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * LIRA-309 US3 — recharge a line held for sale from one of three sources
   * (owner, 2026-10-11). The recharge's cost `c` (USD) is added to the line's
   * cost, selling price and open batch unit cost, so its profit when sold is
   * unchanged ($15/$25 + $3 of days → $18/$28 → still $10). No expense.
   *
   * - DAYS: days taken from a shop line (default primary): the shop line
   *   loses the days and their cost in credits, the carrier drawer drops by
   *   the cost (drawer = Σ shop-line credits, LIRA-252); c = the days' cost.
   * - SHOP_LINE_CREDIT: credit moved from a shop line plus the SMS fee; the
   *   shop line and carrier drawer drop by credit + fee; c = credit at the
   *   shop's credit cost rate + the fee (no separate SMS expense).
   * - CARD: an iPick/Katsh MTC/Alfa card, paid from that balance (LBP);
   *   c = card cost ÷ the USD rate.
   *
   * Every write is tied to one LINE_RECHARGE transaction and undone by the
   * generic void (`_reverseResaleLineRecharge`, newest first, not once sold).
   */
  recharge(
    input: RechargeResaleLineData,
    userId: number,
  ): ResaleLineRechargeResult {
    try {
      return this.repo.withTransaction(() => {
        const line = this.repo
          .listLines({ includeSold: false })
          .find((l) => l.product_id === input.product_id);
        if (!line) return fail("This line is not in stock.");
        if (!line.resale_line_id || !line.carrier) {
          return fail("Save this line's carrier on the Phone Lines page first.");
        }
        const day = input.client_day ?? clientDay();
        if (classifyLineValidity(line.validity_expires_at, day).state === "BURNED") {
          return fail(
            "This line has expired past its grace period and can no longer be recharged.",
          );
        }
        const rate = input.exchange_rate ?? this.repo.getUsdSellRate();
        const label = line.carrier === "mtc" ? "MTC" : "Alfa";
        const carrierMismatch = `Use an ${label} card or line for this ${label} number.`;
        const carrierDrawer = label;

        let costUsd = 0;
        let daysAdded = 0;
        let creditsAdded = 0;
        const legs: RecordRechargeInput["legs"] = [];
        let sourceMovement: RecordRechargeInput["sourceMovement"];
        let mobileServiceItemId: number | undefined;

        if (input.source === "CARD") {
          const card = this.repo.getCard(input.mobile_service_item_id as number);
          if (!card || !isLineChargeProvider(card.provider)) {
            return fail(LINE_CHARGE_PROVIDER_ERROR);
          }
          if (card.category.toLowerCase() !== line.carrier) return fail(carrierMismatch);
          if (!(card.cost_lbp > 0)) return fail("Enter what this recharge cost before saving.");
          mobileServiceItemId = card.id;
          daysAdded = card.validity_days ?? 0;
          creditsAdded = card.credits ?? 0;
          costUsd = round2(card.cost_lbp / rate);
          legs.push({
            method: "LINE_RECHARGE",
            drawerName: this.repo.providerDrawerName(card.provider),
            currency: "LBP",
            amount: -card.cost_lbp,
            note: `Line recharge cost: ${card.label}`,
          });
        } else {
          const src = this.repo.getSourceShopLine(line.carrier, input.source_carrier_line_id);
          if (!src || !src.is_active) return fail(`Pick an active ${label} shop line.`);
          if (src.carrier !== line.carrier) return fail(carrierMismatch);

          if (input.source === "DAYS") {
            const days = input.days as number;
            const v = classifyLineValidity(src.validity_expires_at, day);
            // Owner, 2026-10-13: days can't be checked against a shop line
            // with no expiry — ask for it first.
            if (v.state === "NO_EXPIRY") {
              return fail(
                `Set the expiry of shop line ${src.phone_number} first (Phone Lines → Shop lines).`,
              );
            }
            if (v.state !== "VALID" || v.daysRemaining < days) {
              return fail(
                `Shop line ${src.phone_number} has only ${Math.max(v.daysRemaining, 0)} days left.`,
              );
            }
            daysAdded = days;
            costUsd = round2(input.days_cost_usd as number);
            legs.push({
              method: "VALIDITY_DAYS_COST",
              drawerName: carrierDrawer,
              currency: "USD",
              amount: -costUsd,
              note: `Validity days cost: ${days} days (line for sale)`,
            });
            sourceMovement = {
              carrierLineId: src.id,
              creditsDelta: -costUsd,
              validityDaysDelta: -days,
              reason: "RESALE_DAYS",
            };
          } else {
            const credits = input.credits as number;
            const fee = round2(planSmsTransfer(credits).feeUsd);
            const total = round2(credits + fee);
            // Owner, 2026-10-13: allowed when the shop line is low, like a
            // credit sale today (the line may go below zero).
            creditsAdded = credits;
            costUsd = round2((credits * this.repo.getCreditCostRateLbp()) / rate + fee);
            legs.push({
              method: carrierDrawer,
              drawerName: carrierDrawer,
              currency: "USD",
              amount: -credits,
              note: "Telecom balance sent (line for sale)",
            });
            if (fee > 0) {
              legs.push({
                method: carrierDrawer,
                drawerName: carrierDrawer,
                currency: "USD",
                amount: -fee,
                note: "SMS transfer fee (line for sale)",
              });
            }
            sourceMovement = {
              carrierLineId: src.id,
              creditsDelta: -total,
              validityDaysDelta: 0,
              reason: "RESALE_TRANSFER",
            };
          }
        }

        if (!(costUsd > 0)) return fail("Enter what this recharge cost before saving.");

        let newExpiry = line.validity_expires_at;
        if (daysAdded > 0) {
          const projected = projectValidityExpiry(line.validity_expires_at, daysAdded, day);
          if (projected.burned) {
            return fail(
              "This line has expired past its grace period and can no longer be recharged.",
            );
          }
          newExpiry = projected.expiry;
        }
        const newCredits = round2((line.credits ?? 0) + creditsAdded);

        const written = this.repo.recordRecharge({
          productId: line.product_id,
          resaleLineId: line.resale_line_id,
          source: input.source,
          userId,
          costUsd,
          exchangeRate: rate,
          today: day,
          summary: `Line recharge: ${line.phone_number ?? line.name} (${sourceLabel(input.source)}) — cost +$${costUsd}`,
          daysAdded,
          creditsAdded,
          prevCredits: line.credits ?? 0,
          prevExpiry: line.validity_expires_at,
          newCredits,
          newExpiry,
          mobileServiceItemId,
          sourceCarrierLineId: sourceMovement?.carrierLineId,
          legs,
          sourceMovement,
        });
        inventoryLogger.info(
          { productId: line.product_id, source: input.source, costUsd },
          "For-sale line recharged",
        );
        return {
          success: true as const,
          data: {
            transaction_id: written.transactionId,
            recharge_id: written.rechargeId,
            cost_usd: costUsd,
            line: {
              cost_usd: round2(line.cost_price_usd + costUsd),
              price_usd: round2(line.selling_price_usd + costUsd),
              validity_expires_at: newExpiry,
              credits: newCredits,
            },
          },
        };
      });
    } catch (error) {
      inventoryLogger.error(
        { error, productId: input.product_id },
        "Failed to recharge for-sale line",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * LIRA-337 — give part of a line's credit back to one of the shop's own
   * lines before the sale (owner, 2026-10-18). The figures come from
   * `planLineGiveBack`, the same function the screen previews with:
   * the line keeps what the buyer asked for (the sender pays the SMS fee),
   * the shop line and carrier drawer gain the credit sent, the price drops
   * by the credit that left × the typed credit price, and the cost drops by
   * the credit sent × the shop's credit cost rate. One
   * LINE_CREDIT_GIVE_BACK transaction; undone by the generic void
   * (`_reverseResaleLineGiveBack`, newest first, not once sold).
   */
  giveBack(input: GiveBackResaleLineData, userId: number): ResaleLineGiveBackResult {
    try {
      return this.repo.withTransaction(() => {
        const line = this.repo
          .listLines({ includeSold: false })
          .find((l) => l.product_id === input.product_id);
        if (!line) return fail("This line is not in stock.");
        if (!line.resale_line_id || !line.carrier) {
          return fail("Save this line's carrier on the Phone Lines page first.");
        }
        const day = input.client_day ?? clientDay();
        if (classifyLineValidity(line.validity_expires_at, day).state === "BURNED") {
          return fail(
            "This line has expired past its grace period and can no longer be recharged.",
          );
        }
        const label = line.carrier === "mtc" ? "MTC" : "Alfa";
        const shop = this.repo.getSourceShopLine(line.carrier, input.carrier_line_id);
        if (!shop || !shop.is_active) return fail(`Pick an active ${label} shop line.`);
        if (shop.carrier !== line.carrier) {
          return fail(`Use an ${label} card or line for this ${label} number.`);
        }

        const rate = input.exchange_rate ?? this.repo.getUsdSellRate();
        const costRate = this.repo.getCreditCostRateLbp();
        const plan = planLineGiveBack({
          creditsBefore: line.credits ?? 0,
          creditsKept: input.credits_kept,
          creditSellPriceLbp: input.credit_sell_price_lbp,
          creditCostRateLbp: costRate,
          exchangeRate: rate,
        });
        if (!plan.ok) return fail(plan.error);

        const newPrice = round2(line.selling_price_usd - plan.priceDropUsd);
        const newCost = round2(line.cost_price_usd - plan.costDropUsd);
        if (newPrice < 0) return fail("This line's price would go below zero.");
        if (newCost < 0) return fail("This line's cost would go below zero.");

        const written = this.repo.recordGiveBack({
          productId: line.product_id,
          resaleLineId: line.resale_line_id,
          carrier: line.carrier,
          carrierLineId: shop.id,
          userId,
          today: day,
          summary: `Give credit back: ${line.phone_number ?? line.name} → ${label} line ${shop.phone_number} +$${plan.creditsSent} — price −$${plan.priceDropUsd}`,
          creditsSent: plan.creditsSent,
          smsFeeUsd: plan.smsFeeUsd,
          creditSellPriceLbp: input.credit_sell_price_lbp,
          creditCostRateLbp: costRate,
          exchangeRate: rate,
          priceDropUsd: plan.priceDropUsd,
          costDropUsd: plan.costDropUsd,
          prevCredits: line.credits ?? 0,
          newCredits: plan.creditsAfter,
        });
        inventoryLogger.info(
          { productId: line.product_id, creditsSent: plan.creditsSent },
          "Credit given back from for-sale line",
        );
        return {
          success: true as const,
          data: {
            transaction_id: written.transactionId,
            give_back_id: written.giveBackId,
            credits_sent: plan.creditsSent,
            sms_fee_usd: plan.smsFeeUsd,
            price_drop_usd: plan.priceDropUsd,
            cost_drop_usd: plan.costDropUsd,
            line: { credits: plan.creditsAfter, price_usd: newPrice, cost_usd: newCost },
          },
        };
      });
    } catch (error) {
      inventoryLogger.error(
        { error, productId: input.product_id },
        "Failed to give credit back from for-sale line",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function fail(error: string): { success: false; error: string } {
  return { success: false, error };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sourceLabel(source: RechargeResaleLineData["source"]): string {
  return source === "DAYS" ? "days" : source === "CARD" ? "card" : "shop-line credit";
}

// =============================================================================
// Singleton Instance
// =============================================================================

let resaleLineServiceInstance: ResaleLineService | null = null;

export function getResaleLineService(): ResaleLineService {
  if (!resaleLineServiceInstance) {
    resaleLineServiceInstance = new ResaleLineService();
  }
  return resaleLineServiceInstance;
}

export function resetResaleLineService(): void {
  resaleLineServiceInstance = null;
}

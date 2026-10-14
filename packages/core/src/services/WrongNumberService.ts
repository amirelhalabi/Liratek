/**
 * LIRA-312 — a MTC/Alfa card recharged onto the WRONG number from
 * iPick/Katsh/Whish App. Orchestration only; all SQL lives in
 * `WrongNumberRepository` / `ExpenseRepository` (rule 13).
 *
 * "Wrong number" is NOT a refund (research R1): the sale stays untouched and
 * now stands for the correct recharge of the right number. The wasted card
 * is booked as a stock-use expense of the same card (the loss, paid from the
 * provider balance). Credits sent back later are entered against the record
 * and reduce the loss at the resold-credit price.
 *
 * Spec: `specs/312-wrong-number-recharge/spec.md`.
 */
import {
  getWrongNumberRepository,
  withTotals,
  type WrongNumberCardRow,
  type WrongNumberCarrier,
  type WrongNumberRepository,
} from "../repositories/WrongNumberRepository.js";
import {
  getExpenseRepository,
  type ExpenseRepository,
} from "../repositories/ExpenseRepository.js";
import {
  isSameLebanesePhone,
  normalizeLineNumber,
} from "../utils/phoneNumber.js";
import { expenseLogger } from "../utils/logger.js";
import type { CatalogStockExpenseSource } from "../constants/transactionTypes.js";
import {
  WRONG_NUMBER_EXPENSE_CATEGORY,
  isWrongNumberCardSale,
  type ListWrongNumbersQuery,
  type RecordWrongNumberData,
  type WrongNumberCreditsData,
  type WrongNumberProvider,
  type WrongNumberStatus,
} from "../validators/wrongNumber.js";

export { WRONG_NUMBER_EXPENSE_CATEGORY } from "../validators/wrongNumber.js";

/** Refused when the credits entries would exceed what the card carried. */
export function tooMuchCreditError(cardCreditUsd: number): string {
  return `That is more credit than the card carried ($${cardCreditUsd}).`;
}

export { UNDO_CREDITS_FIRST_ERROR } from "../repositories/wrongNumberSql.js";

const PROVIDER_STOCK_SOURCE: Record<
  WrongNumberProvider,
  CatalogStockExpenseSource
> = {
  iPick: "IPICK",
  Katsh: "KATSH",
  WHISH_APP: "WHISH_APP",
};

const PROVIDER_LABEL: Record<WrongNumberProvider, string> = {
  iPick: "iPick",
  Katsh: "Katsh",
  WHISH_APP: "Whish App",
};

export type WrongNumberResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface RecordWrongNumberResultData {
  id: number;
  expense_transaction_id: number;
  status: WrongNumberStatus;
  remaining_loss_lbp: number;
}

export interface WrongNumberCreditsResultData {
  transaction_id: number;
  total_recovered_usd: number;
  remaining_loss_lbp: number;
  status: WrongNumberStatus;
}

/** A refusal the service raises inside its DB transaction (rolls back). */
class Refusal extends Error {}

export class WrongNumberService {
  private repo: WrongNumberRepository;
  private expenseRepoRef: ExpenseRepository | null;

  constructor(repo?: WrongNumberRepository, expenseRepo?: ExpenseRepository) {
    this.repo = repo ?? getWrongNumberRepository();
    this.expenseRepoRef = expenseRepo ?? null;
  }

  private get expenseRepo(): ExpenseRepository {
    if (!this.expenseRepoRef) this.expenseRepoRef = getExpenseRepository();
    return this.expenseRepoRef;
  }

  /** Records with their totals (and, with `id`, one record). */
  list(query: ListWrongNumbersQuery = {}): WrongNumberCardRow[] {
    return this.repo.list(query);
  }

  /**
   * Record a wrong-number card (path A from Expenses, path B from a saved
   * sale). Books the card's cost as a stock-use expense from the provider
   * balance (the loss) and links it in `wrong_number_cards`. When credits
   * already came back, the first entry is written in the same transaction.
   */
  recordWrongNumber(
    input: RecordWrongNumberData,
    userId: number,
  ): WrongNumberResult<RecordWrongNumberResultData> {
    try {
      const data = this.repo.withTransaction(() => {
        const providerLabel = PROVIDER_LABEL[input.provider];
        const card = this.repo.getCardItem(
          input.mobile_service_item_id,
          input.provider,
        );
        if (!card || !(card.cost_lbp > 0)) {
          throw new Refusal("Pick the MTC or Alfa card that was sent.");
        }
        // The card's credit caps the credits that can come back; with none
        // set, no credits could ever be entered against the record.
        if (!(Number(card.credits) > 0)) {
          throw new Refusal(
            "Set this card's credit in Settings → Mobile Services first.",
          );
        }
        const carrier = card.category.toLowerCase() as WrongNumberCarrier;

        let saleTransactionId: number | null = null;
        let rightNumber: string | null = null;
        if (input.sale_transaction_id !== undefined) {
          const sale = this.repo.getSale(input.sale_transaction_id);
          const saleMeta = readMeta(sale?.metadata_json ?? null);
          if (
            !sale ||
            sale.type !== "FINANCIAL_SERVICE" ||
            sale.is_reversed === 1 ||
            !isWrongNumberCardSale(saleMeta) ||
            saleMeta.provider !== input.provider
          ) {
            throw new Refusal(
              `This sale is not a card recharge from ${providerLabel}.`,
            );
          }
          saleTransactionId = sale.id;
        }
        if (input.right_number !== undefined) {
          if (isSameLebanesePhone(input.right_number, input.wrong_number)) {
            throw new Refusal("The right number is the same as the wrong one.");
          }
          rightNumber = normalizeLineNumber(input.right_number);
        }
        const wrongNumber = normalizeLineNumber(input.wrong_number);

        const note = input.note?.trim();
        const expenseId = this.expenseRepo.createStockExpense(
          {
            source: PROVIDER_STOCK_SOURCE[input.provider],
            item_id: card.id,
            quantity: 1,
            category: WRONG_NUMBER_EXPENSE_CATEGORY,
            description: `Wrong number ${wrongNumber} — ${card.label}${note ? ` — ${note}` : ""}`,
            expense_date: input.expense_date,
          },
          userId,
        );
        const expenseTransactionId =
          this.repo.getExpenseTransactionId(expenseId);
        if (!expenseTransactionId) {
          throw new Error("The wrong-number expense was not recorded.");
        }

        const id = this.repo.insertRecord({
          expenseId,
          expenseTransactionId,
          saleTransactionId,
          provider: input.provider,
          carrier,
          mobileServiceItemId: card.id,
          cardLabel: card.label,
          cardCostLbp: card.cost_lbp,
          cardCreditUsd: Number(card.credits),
          wrongNumber,
          rightNumber,
        });

        if (input.credits_received) {
          this.writeCredits(
            id,
            input.credits_received.amount_usd,
            input.credits_received.carrier_line_id,
            userId,
            input.expense_date,
          );
        }

        const row = this.getRow(id);
        return {
          id,
          expense_transaction_id: expenseTransactionId,
          status: row.status,
          remaining_loss_lbp: row.remaining_loss_lbp,
        };
      });
      expenseLogger.info(
        { id: data.id, provider: input.provider, userId },
        "Wrong-number card recorded",
      );
      return { success: true, data };
    } catch (error) {
      return this.fail(error, "Failed to record wrong-number card", input);
    }
  }

  /**
   * Credits sent back for a wrong-number card (research R4/R5). The chosen
   * active shop line of the card's carrier and its drawer go up by X; the
   * loss falls by X × the resold-credit price. Entries add up to at most the
   * credit the card carried.
   */
  recordCreditsReceived(
    input: WrongNumberCreditsData,
    userId: number,
  ): WrongNumberResult<WrongNumberCreditsResultData> {
    try {
      const data = this.repo.withTransaction(() => {
        const transactionId = this.writeCredits(
          input.wrong_number_card_id,
          input.amount_usd,
          input.carrier_line_id,
          userId,
          input.client_day,
        );
        const row = this.getRow(input.wrong_number_card_id);
        return {
          transaction_id: transactionId,
          total_recovered_usd: row.total_recovered_usd,
          remaining_loss_lbp: row.remaining_loss_lbp,
          status: row.status,
        };
      });
      expenseLogger.info(
        { id: input.wrong_number_card_id, amountUsd: input.amount_usd, userId },
        "Wrong-number credits recorded",
      );
      return { success: true, data };
    } catch (error) {
      return this.fail(error, "Failed to record wrong-number credits", input);
    }
  }

  /** Validates and writes one credits entry; returns its transaction id. */
  private writeCredits(
    recordId: number,
    amountUsd: number,
    carrierLineId: number,
    userId: number,
    today?: string,
  ): number {
    const record = this.repo.getRecord(recordId);
    if (!record) throw new Refusal("Wrong-number record not found.");
    if (this.getRow(recordId).status === "VOIDED") {
      throw new Refusal("This wrong-number record has been undone.");
    }

    const carrierLabel = record.carrier === "mtc" ? "MTC" : "Alfa";
    const line = this.repo.getCarrierLine(carrierLineId);
    if (!line || !line.is_active || line.carrier !== record.carrier) {
      throw new Refusal(`Pick an active ${carrierLabel} shop line.`);
    }

    const already = this.repo
      .getActiveCredits(recordId)
      .reduce((s, c) => s + c.amount_usd, 0);
    if (round2(already + amountUsd) > record.card_credit_usd) {
      throw new Refusal(tooMuchCreditError(record.card_credit_usd));
    }

    return this.repo.insertCreditsReceived({
      record,
      line,
      amountUsd: round2(amountUsd),
      creditRateLbp: this.repo.getCreditSellPriceLbp(),
      userId,
      today,
    });
  }

  private getRow(id: number): WrongNumberCardRow {
    const row = this.repo.list({ id })[0];
    if (row) return row;
    const record = this.repo.getRecord(id);
    if (!record) throw new Refusal("Wrong-number record not found.");
    return withTotals(record, [], false);
  }

  private fail(
    error: unknown,
    message: string,
    input: unknown,
  ): { success: false; error: string } {
    if (error instanceof Refusal) return { success: false, error: error.message };
    expenseLogger.error({ error, input }, message);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readMeta(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// =============================================================================
// Singleton Instance
// =============================================================================

let wrongNumberServiceInstance: WrongNumberService | null = null;

export function getWrongNumberService(): WrongNumberService {
  if (!wrongNumberServiceInstance) {
    wrongNumberServiceInstance = new WrongNumberService();
  }
  return wrongNumberServiceInstance;
}

export function resetWrongNumberService(): void {
  wrongNumberServiceInstance = null;
}

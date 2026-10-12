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
import { clientDay } from "../utils/requestDay.js";
import { inventoryLogger } from "../utils/logger.js";
import type {
  ListResaleLinesQuery,
  SaveResaleLineData,
  WriteOffResaleLineData,
} from "../validators/resaleLine.js";

/** The expense category a written-off line is booked under. */
export const LOST_PHONE_LINE_CATEGORY = "Lost phone line";

/** One message for both directions of FR-005 (a number can be a shop line
 *  or an unsold for-sale line, never both). */
export const LINE_NUMBER_TAKEN_ERROR =
  "This number is already one of your lines.";

export type ResaleLineResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

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

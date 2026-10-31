/**
 * LIRA-365 — a discount the shop gave where it has no margin of its own to
 * take it from, booked as a small expense (owner decision 2026-10-31):
 *
 *   - OMT/Whish system SEND: the whole transfer + fee is still owed to the
 *     provider, the commission comes at settlement, so the $2 the customer
 *     did not pay is the shop's cost.
 *   - Voucher sale: the voucher keeps its full face value.
 *
 * The ONE writer both flows call (rule 14). Same shape as the change-rounding
 * expense (changeRoundingExpense.ts):
 *
 *   - Books-only (`books_only`): no payments row, no drawer movement — the
 *     customer's legs already brought in the discounted amount; a drawer
 *     debit here would count the discount twice.
 *   - Auto sibling (rule 26): linked to the parent by `source_ref_table` /
 *     `source_ref_id`, so `ExpenseRepository` derives `is_auto` from the link.
 *   - Reversal owner (rule 20): OMT/Whish → `TransactionRepository.
 *     _cascadeExpenseSiblingVoid` (generic void/refund); voucher →
 *     `VoucherRepository.cancelWithRefund` via `voidLinkedExpenses`.
 */
import { DISCOUNT_GIVEN_EXPENSE_CATEGORY } from "../validators/discount.js";
import { clientDay } from "../utils/requestDay.js";
import { getExpenseRepository } from "./ExpenseRepository.js";

export { DISCOUNT_GIVEN_EXPENSE_CATEGORY };

export interface DiscountGivenExpenseInput {
  /** The parent's own `source_table` / `source_id` — the link the void
   *  cascade matches on. */
  parentSourceTable: string;
  parentSourceId: number;
  /** Shown in the expense description, e.g. "OMT send #418". */
  parentLabel: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  userId: number;
  transactionTime?: string | undefined;
  clientDay?: string | undefined;
}

/** Books the discount (no-op for zero). Call inside the parent's db
 *  transaction, after the parent's transaction row exists. */
export function bookDiscountGivenExpense(
  input: DiscountGivenExpenseInput,
): void {
  const amount = input.amount || 0;
  if (amount <= 0) return;
  const isLbp = input.currency === "LBP";
  getExpenseRepository().createExpense(
    {
      description: `Discount given (${input.parentLabel})`,
      category: DISCOUNT_GIVEN_EXPENSE_CATEGORY,
      paid_by_method: "CASH",
      amount_usd: isLbp ? 0 : amount,
      amount_lbp: isLbp ? amount : 0,
      // The parent's own (possibly backdated) time, else the client's day
      // (rule 27) — same day rule as the change-rounding expense.
      expense_date: input.transactionTime ?? input.clientDay ?? clientDay(),
      transaction_time: input.transactionTime,
      // The customer's legs already brought in the discounted amount.
      books_only: true,
      source_ref_table: input.parentSourceTable,
      source_ref_id: input.parentSourceId,
      tender_exchange_rate: input.exchangeRate,
      extra_metadata: { discount_given: { amount, currency: input.currency } },
    },
    input.userId,
  );
}

/**
 * LBP change rounding booked as a small expense (owner decision 2026-10-16).
 *
 * The payment box rounds LBP change UP to the next 5,000 note (`roundLBPUp`,
 * LIRA-264). The shop hands the customer a little more than the exact
 * change, and before this nothing recorded it: the drawer matched the cash
 * (the change leg moved the 90,000 really handed back), but the books said
 * the shop kept $26 when it kept $25.955. This writes that gap as an auto
 * EXPENSE row so books = cash, and net profit drops by it (Profits subtracts
 * expenses — the sale's own profit stamp is not touched, so it is never
 * lowered twice).
 *
 * The ONE writer every customer-pays flow calls (rule 14). The amount comes
 * from the pure `lbpChangeRounding` (utils/changeRounding.ts) — the same
 * note rule the payment box rounds with.
 *
 *   - Books-only (`books_only`): no payments row, no drawer movement — the
 *     parent's change leg already moved the cash; a second debit would
 *     double-count it.
 *   - Auto sibling (rule 26): linked to the parent by `source_ref_table` /
 *     `source_ref_id` (the parent transaction's own `source_table` /
 *     `source_id`), so `ExpenseRepository` derives `is_auto` from the link
 *     and the Transactions table hides it by default.
 *   - Reversal owner (rule 20): `TransactionRepository.
 *     _cascadeExpenseSiblingVoid`, which voids every linked expense when the
 *     parent is voided or refunded — the same path as the SMS fee expense.
 *     A partial item refund leaves it in place: the rounding was really
 *     handed over and is not given back by a refund of the goods.
 *
 * Covered flows (callers): POS sale (`SalesRepository.processSale`) and
 * Maintenance checkout (`MaintenanceRepository`) — the two USD-priced
 * checkouts that send change as `change_given_*` / `changeUsd/changeLbp`
 * and whose payment box seeds the rounded LBP remainder (CheckoutModal
 * `smartSplitOverpay`). Not covered yet: session basket checkout (its
 * change legs belong to the session, not one parent transaction a void
 * could cascade from) and flows whose change is an OUT leg in `payments[]`
 * (recharge, services, custom services), where the rounding only appears
 * when the cashier taps "All in LBP".
 */
import { lbpChangeRounding } from "../utils/changeRounding.js";
import type { ChangeRoundingLeg } from "../utils/changeRounding.js";
import { clientDay } from "../utils/requestDay.js";
import { getExpenseRepository } from "./ExpenseRepository.js";

/** The expense category of a change-rounding expense. */
export const CHANGE_ROUNDING_EXPENSE_CATEGORY = "Change rounding";

export interface ChangeRoundingExpenseInput {
  /** The parent transaction's own `source_table` / `source_id` — the link
   *  the void/refund cascade matches on. */
  parentSourceTable: string;
  parentSourceId: number;
  /** Shown in the expense description, e.g. "Sale #183". */
  parentLabel: string;
  due: { usd: number; lbp: number };
  inLegs: ChangeRoundingLeg[];
  cashChange: { usd: number; lbp: number };
  exchangeRate: number;
  userId: number;
  transactionTime?: string;
  clientDay?: string;
}

/**
 * Books the rounding (if any) and returns the LBP amount booked — 0 when
 * the change was exact or was not note rounding. Call it inside the
 * parent's db transaction, after the parent's legs are posted.
 */
export function bookChangeRoundingExpense(
  input: ChangeRoundingExpenseInput,
): number {
  const rounding = lbpChangeRounding({
    due: input.due,
    inLegs: input.inLegs,
    cashChange: input.cashChange,
    exchangeRate: input.exchangeRate,
  });
  if (rounding <= 0) return 0;
  getExpenseRepository().createExpense(
    {
      description: `Change rounded up to the next note (${input.parentLabel})`,
      category: CHANGE_ROUNDING_EXPENSE_CATEGORY,
      paid_by_method: "CASH",
      amount_usd: 0,
      amount_lbp: rounding,
      // Same day rule as the SMS fee expense (rule 27).
      expense_date: input.transactionTime ?? input.clientDay ?? clientDay(),
      transaction_time: input.transactionTime,
      books_only: true,
      source_ref_table: input.parentSourceTable,
      source_ref_id: input.parentSourceId,
      tender_exchange_rate: input.exchangeRate,
      extra_metadata: {
        change_rounding_lbp: rounding,
        change_handed_lbp: Math.abs(input.cashChange.lbp || 0),
      },
    },
    input.userId,
  );
  return rounding;
}

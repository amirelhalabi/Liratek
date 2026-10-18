/**
 * LIRA-335 — the "Drawer shortage" expense a closed Short checkpoint
 * difference owns (spec FR-011/012/016, owner decision 2026-10-18).
 *
 * Nothing turned up on camera, so the owner closes the Short: the amount
 * still open becomes a loss in the books, on the checkpoint's own day, so
 * net profit for that day drops by it.
 *
 *   - Books-only (`books_only`): no payments row, no drawer movement — the
 *     checkpoint already set the drawer to the counted cash (FR-015).
 *   - Auto row (rule 26): linked to its owner by `source_ref_table =
 *     'checkpoint_differences'` / `source_ref_id = difference id`, so
 *     `ExpenseRepository` derives `is_auto` from the link and the
 *     Transactions table hides it by default. The Expenses page still shows
 *     it (it is a real cost).
 *   - Reversal owner (rule 20): `CheckpointDifferenceRepository
 *     .syncShortageExpense` — run by Reopen, by a resolution that explains
 *     part of a closed Short, and by the void of such a resolver. Never voided
 *     on its own from the Expenses page (FR-013).
 *   - Dated `expense_date = daily_closings.closing_date` — the client day
 *     stored with the checkpoint, never the server's (rule 27).
 *   - USD or LBP only: expenses hold no other currency; a Short in EUR or
 *     USDT closes with no expense.
 */
import { getExpenseRepository } from "./ExpenseRepository.js";
import {
  CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
  DRAWER_SHORTAGE_EXPENSE_CATEGORY,
  DRAWER_SHORTAGE_EXPENSE_CURRENCIES,
} from "../constants/checkpointAdjustment.js";

// The three names live in the pure constants module so the browser can read
// them (rule 29); re-exported here so the writer's own module carries them.
export {
  CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
  DRAWER_SHORTAGE_EXPENSE_CATEGORY,
  DRAWER_SHORTAGE_EXPENSE_CURRENCIES,
};

export interface DrawerShortageExpenseInput {
  differenceId: number;
  drawerName: string;
  /** USD or LBP (see {@link DRAWER_SHORTAGE_EXPENSE_CURRENCIES}). */
  currencyCode: string;
  /** Magnitude of the shortage still open (positive). */
  amount: number;
  /** `daily_closings.closing_date` of the checkpoint (`YYYY-MM-DD`). */
  closingDate: string;
  closingId: number;
  userId: number;
}

/** Books the shortage expense and returns its `expenses.id`. Call inside
 *  the caller's db transaction. Throws for a currency an expense cannot
 *  hold or a non-positive amount — the caller decides those first. */
export function bookDrawerShortageExpense(
  input: DrawerShortageExpenseInput,
): number {
  if (!DRAWER_SHORTAGE_EXPENSE_CURRENCIES.includes(input.currencyCode)) {
    throw new Error(
      `A drawer shortage expense cannot be booked in ${input.currencyCode}`,
    );
  }
  const amount = Math.abs(input.amount);
  if (!(amount > 0)) {
    throw new Error("A drawer shortage expense needs a positive amount");
  }
  return getExpenseRepository().createExpense(
    {
      description: `Drawer shortage (${input.drawerName}, checkpoint #${input.closingId})`,
      category: DRAWER_SHORTAGE_EXPENSE_CATEGORY,
      paid_by_method: "CASH",
      amount_usd: input.currencyCode === "USD" ? amount : 0,
      amount_lbp: input.currencyCode === "LBP" ? amount : 0,
      expense_date: input.closingDate,
      books_only: true,
      source_ref_table: CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
      source_ref_id: input.differenceId,
      extra_metadata: {
        checkpoint_difference_id: input.differenceId,
        closing_id: input.closingId,
        drawer_name: input.drawerName,
      },
    },
    input.userId,
  );
}

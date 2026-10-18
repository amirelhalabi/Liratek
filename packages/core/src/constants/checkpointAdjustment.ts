/**
 * `payments.method` code written by `ClosingRepository`'s checkpoint
 * reconciliation legs — the balance adjustment posted when a checkpoint's
 * physical count differs from the live drawer balance.
 *
 * Lives in its own leaf constants module (not in `ClosingRepository`, a
 * repository the browser bundle must never reach — CLAUDE.md rule 29) so the
 * frontend's audit display can import the ONE definition (rule 14) instead of
 * retyping the string literal to build its "Checkpoint <Drawer>" label.
 */
export const CHECKPOINT_ADJUSTMENT_METHOD = "CHECKPOINT_ADJUSTMENT";

/**
 * LIRA-335 — `payments.method` of the offset leg a back-timed transaction
 * posts when it resolves a checkpoint's open difference (the checkpoint
 * already put that money into the expected balance, so the transaction must
 * not move the drawer a second time).
 *
 *   - Drawer-moving: it is NOT audit-only, so every drawer sum
 *     (`drawerAffectingPayments`, `getDrawerBalancesAsOf`,
 *     `recalculateDrawerBalances`) counts it.
 *   - Internal leg: hidden from customer-facing legs and payment-method
 *     reports (`INTERNAL_LEG_METHODS`).
 *   - Mirrored on VOID (the transaction never happened, so the resolution is
 *     undone and the drawer nets to zero).
 *   - Skipped on REFUND (the counted cash was real; a refund is new cash
 *     handed back now and moves the drawer by exactly that).
 */
export const CHECKPOINT_RESOLUTION_METHOD = "CHECKPOINT_RESOLUTION";

/**
 * LIRA-335 — the expense category of the books-only "Drawer shortage"
 * expense a closed Short difference owns. Lives here (a pure leaf reachable
 * from `browser.ts`, rule 29) so the Expenses page can label and lock the
 * row from the same definition the writer uses (rule 14);
 * `repositories/drawerShortageExpense.ts` re-exports it.
 */
export const DRAWER_SHORTAGE_EXPENSE_CATEGORY = "Drawer shortage";

/**
 * LIRA-335 — the currencies a Drawer shortage expense can be booked in.
 * Expenses hold USD and LBP only (`expenses.amount_usd` / `amount_lbp`), so
 * a Short in any other currency closes with no expense. Read by the writer
 * (`repositories/drawerShortageExpense.ts`) and by the close dialog's
 * wording (rule 14).
 */
export const DRAWER_SHORTAGE_EXPENSE_CURRENCIES: readonly string[] = [
  "USD",
  "LBP",
];

/** LIRA-335 — `expenses.source_ref_table` of a Drawer shortage expense
 *  (`source_ref_id` = the `checkpoint_differences.id` that owns it). */
export const CHECKPOINT_DIFFERENCE_SOURCE_TABLE = "checkpoint_differences";

/**
 * LIRA-335 — below this, what is left open on a checkpoint difference
 * counts as zero: one cent for USD-like currencies, one LBP for LBP (LBP
 * amounts are whole numbers). Per currency, falling back to the USD value.
 *
 * Deliberately NOT the reconciliation threshold `ClosingRepository` posts
 * adjustments above (0.0001): that one decides whether a correction is
 * posted at all; this one decides whether a difference still needs the
 * owner's attention. A posted sub-cent correction records no difference.
 */
export const CHECKPOINT_DIFFERENCE_EPSILON: Readonly<Record<string, number>> =
  {
    USD: 0.01,
    LBP: 1,
  };

/** The open-amount tolerance for `currencyCode` (see
 *  {@link CHECKPOINT_DIFFERENCE_EPSILON}). */
export function checkpointDifferenceEpsilon(currencyCode: string): number {
  return (
    CHECKPOINT_DIFFERENCE_EPSILON[currencyCode] ??
    CHECKPOINT_DIFFERENCE_EPSILON.USD
  );
}

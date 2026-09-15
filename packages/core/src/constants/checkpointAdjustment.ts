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

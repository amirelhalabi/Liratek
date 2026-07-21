/**
 * Void/Refund row-actionability gate (note 21d).
 *
 * TransactionsViewer's per-row Void/Refund buttons used to compute their own
 * inline boolean:
 *
 *   ACTIONABLE_TYPES.has(row.type) && row.status !== "VOIDED" &&
 *   row.type !== "REFUND" && !row.reverses_id
 *
 * That gate misses one case: a transaction that has ALREADY been refunded.
 * `refundTransaction()` deliberately leaves the ORIGINAL row status=ACTIVE
 * with reverses_id=null (so SALE/module + REFUND profit nets to zero — see
 * the doc comment near `_markSourceRefunded` in TransactionRepository.ts) —
 * so none of the four conditions above change on that row. The UI kept
 * offering Void/Refund, and a second click was only caught server-side by
 * `refundTransaction`'s double-refund guard ("Transaction has already been
 * refunded") / `voidTransaction`'s matching guard ("...cannot void it too").
 *
 * `reversed_by_id` (TransactionRepository.getRecent, a correlated subquery
 * over the indexed `reverses_id` column) is the read-model signal that
 * closes the gap: the id of the ACTIVE REFUND row reversing this one, or
 * null. This file is the ONE place the actionability decision is made
 * (rule 14) — TransactionsViewer only calls `isReversibleRow`.
 */

import { ACTIONABLE_TYPES } from "./auditConstants";

export interface ActionGatingFields {
  /** Unified transaction `type` column. */
  type: string;
  /** Unified transaction `status` column ("ACTIVE" | "VOIDED"). */
  status: string;
  /** Set on REFUND rows and VOID reversal rows — never on an original. */
  reverses_id?: number | null;
  /** Set on an original row once it has been refunded (see file doc). */
  reversed_by_id?: number | null;
}

/**
 * Whether a transaction row may still be voided or refunded from the
 * Transactions viewer. Mirrors the backend's real gate
 * (`TransactionRepository._assertReversible` + the void/refund
 * already-refunded guards) at the row-visibility level — the repository
 * call remains the authority; this only decides whether to show the
 * button.
 */
export function isReversibleRow(row: ActionGatingFields): boolean {
  return (
    ACTIONABLE_TYPES.has(row.type) &&
    row.status !== "VOIDED" &&
    row.type !== "REFUND" &&
    row.reverses_id == null &&
    row.reversed_by_id == null
  );
}

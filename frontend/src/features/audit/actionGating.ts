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

import {
  WRONG_NUMBER_EXPENSE_CATEGORY,
  isWrongNumberCardSale,
  type WrongNumberProvider,
} from "@liratek/core";
import { ACTIONABLE_TYPES, parseMetaSafe } from "./auditConstants";

export interface ActionGatingFields {
  /** Unified transaction `type` column. */
  type: string;
  /** Unified transaction `status` column ("ACTIVE" | "VOIDED"). */
  status: string;
  /** Set on REFUND rows and VOID reversal rows — never on an original. */
  reverses_id?: number | null;
  /** Set on an original row once it has been refunded (see file doc). */
  reversed_by_id?: number | null;
  /** A SALE with at least one line refunded item by item (core
   *  `getRecent`, shop-day 2026-10-16) — a whole Void/Refund is refused. */
  item_refunded?: boolean;
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

/**
 * Whether the plain whole-transaction Void / Refund pair is offered. A sale
 * with a line already refunded item by item (`item_refunded`, core
 * `getRecent`, shop-day 2026-10-16) is still reversible item by item, but
 * the server refuses a whole Void/Refund of it
 * (`_assertNoPartialItemRefunds`), so the pair is hidden. Kept apart from
 * `isReversibleRow` so a session sale keeps its "Refund item" button.
 */
export function offersWholeVoidRefund(row: ActionGatingFields): boolean {
  return isReversibleRow(row) && row.item_refunded !== true;
}

// =============================================================================
// LIRA-312 — wrong-number card recharges
// =============================================================================

export type WrongNumberProviderCode = WrongNumberProvider;

export { WRONG_NUMBER_EXPENSE_CATEGORY };

const WRONG_NUMBER_EXPENSE_TYPES: ReadonlySet<string> = new Set([
  "EXPENSE_IPICK",
  "EXPENSE_KATSH",
  "EXPENSE_WHISH_APP",
]);

type WrongNumberRowFields = ActionGatingFields & {
  id: number;
  metadata_json?: string | null;
};

/** The sale's provider when it is an iPick/Katsh/Whish App catalog card
 *  sale (core's `isWrongNumberCardSale`, the same rule the server checks),
 *  else null. */
export function wrongNumberSaleProvider(
  row: WrongNumberRowFields,
): WrongNumberProviderCode | null {
  if (row.type !== "FINANCIAL_SERVICE") return null;
  const meta = parseMetaSafe(row.metadata_json);
  return isWrongNumberCardSale(meta) ? meta.provider : null;
}

/**
 * Whether "Wrong number…" is offered on a row: a live (not voided, not
 * refunded, not a reversal) card sale from iPick, Katsh or Whish App. The
 * sale itself is never reversed by this action, so it is offered on a
 * session basket member too. The server re-checks everything.
 */
export function isWrongNumberEligible(row: WrongNumberRowFields): boolean {
  return (
    wrongNumberSaleProvider(row) !== null &&
    row.status === "ACTIVE" &&
    row.reverses_id == null &&
    row.reversed_by_id == null
  );
}

/**
 * The wrong-number record a row belongs to, for the "Credits…" action: a
 * credits entry (its own metadata names the record) or the wrong-number
 * expense (looked up by its transaction id). Null otherwise.
 */
export function wrongNumberRecordTarget(
  row: WrongNumberRowFields,
):
  | { kind: "record"; recordId: number }
  | { kind: "expense"; expenseTransactionId: number }
  | null {
  if (row.reverses_id != null) return null;
  const meta = parseMetaSafe(row.metadata_json);
  if (row.type === "WRONG_NUMBER_CREDITS") {
    const id = meta.wrong_number_card_id;
    return typeof id === "number" ? { kind: "record", recordId: id } : null;
  }
  if (
    WRONG_NUMBER_EXPENSE_TYPES.has(row.type) &&
    meta.category === WRONG_NUMBER_EXPENSE_CATEGORY
  ) {
    return { kind: "expense", expenseTransactionId: row.id };
  }
  return null;
}

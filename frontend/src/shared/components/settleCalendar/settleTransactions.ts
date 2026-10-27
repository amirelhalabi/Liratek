/**
 * "See transactions" (owner mock 2026-10-26 §7): the generic row of the
 * picked days' table and its open count. Kept apart from the panel
 * component so that file only exports components (fast refresh).
 */

export interface SettleTransactionRow {
  /** Stable row key, the same one the caller's untick set holds. */
  key: string;
  /** Shown as "#id". */
  id: number;
  /** `YYYY-MM-DD`, the shop's day the row sits on. */
  day: string;
  /** The transaction, e.g. "SEND", "POS". */
  label: string;
  /** Which part of the account, e.g. "OMT App", "For". */
  memberTag?: string | null | undefined;
  /** Who / which reference, e.g. "Nour A. · ref OMT-77610". */
  nameRef?: string | null | undefined;
  /** Signed full amount, per currency. */
  amount_usd: number;
  amount_lbp: number;
  /** Signed amount still open, per currency (0 when paid). */
  left_usd: number;
  left_lbp: number;
  /** "waiting": open but outside what may be settled now (no tick). */
  status: "open" | "paid" | "waiting";
  /** In the settlement — from the caller's own payload builder (its
   *  selection keys), never derived again (rule 14). Read for open rows. */
  checked: boolean;
  /** Replaces the default "Waiting for its statement type" wording. */
  waitingNote?: string | null | undefined;
}

/** Open rows (unticked included, paid left out) on the picked days: the
 *  "See transactions (N)" count. */
export function countOpenSettleTransactions(
  rows: readonly SettleTransactionRow[],
  pickedDays: ReadonlySet<string>,
): number {
  return rows.filter((r) => r.status !== "paid" && pickedDays.has(r.day))
    .length;
}

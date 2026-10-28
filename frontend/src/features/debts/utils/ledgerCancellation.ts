/**
 * Which rows of a client's account are cancellations, and which charges
 * they cancelled (owner decision 2026-10-28, option A "show everything,
 * clearly marked").
 *
 * A void or refund of an account-charged sale/service never deletes the
 * charge: it writes a 'Refund Reversal' row that negates it, on the SAME
 * link — the charge's `transaction_id`, or the basket's `session_id` for a
 * session basket (core `insertDebtRefundReversal` / `_cancelSessionDebt`,
 * one reversal per original row). Both rows carry the original's client
 * line, so without this the account read as two (or, with a re-entry,
 * three) identical charges.
 *
 * Pure, and derived from the rows the page already loads — so the page and
 * the client statement mark exactly the same rows (rule 14). Only a reversal
 * that negates a charge exactly, per currency, marks it: a partial refund
 * leaves the charge as it is and still shows its cancellation row.
 */
import type { DebtLedgerEntity } from "@liratek/ui";

/** The debt_ledger type every void/refund cancellation writes (core
 *  `repositories/debtReversal.ts`, `TransactionRepository._cancelSessionDebt`). */
export const LEDGER_REVERSAL_TYPE = "Refund Reversal";

type LedgerRow = Pick<
  DebtLedgerEntity,
  | "id"
  | "transaction_type"
  | "transaction_id"
  | "session_id"
  | "amount_usd"
  | "amount_lbp"
>;

export function isLedgerReversal(row: Pick<LedgerRow, "transaction_type">) {
  return row.transaction_type === LEDGER_REVERSAL_TYPE;
}

const linkKey = (row: LedgerRow): string | null =>
  row.transaction_id != null
    ? `t:${row.transaction_id}`
    : row.session_id != null
      ? `s:${row.session_id}`
      : null;

const USD_EPS = 0.005;
const LBP_EPS = 0.5;

/** True when `reversal` is exactly `charge` negated, per currency. */
const negates = (reversal: LedgerRow, charge: LedgerRow): boolean =>
  Math.abs((reversal.amount_usd ?? 0) + (charge.amount_usd ?? 0)) < USD_EPS &&
  Math.abs((reversal.amount_lbp ?? 0) + (charge.amount_lbp ?? 0)) < LBP_EPS;

/** The cancellations found in a client's rows: the originals cancelled in
 *  full, and for each matched 'Refund Reversal' row the original it
 *  cancels. */
export interface LedgerCancellations<T extends LedgerRow> {
  cancelled: ReadonlySet<number>;
  reversalOf: ReadonlyMap<number, T>;
}

export function ledgerCancellations<T extends LedgerRow>(
  rows: readonly T[],
): LedgerCancellations<T> {
  const groups = new Map<string, { charges: T[]; reversals: T[] }>();
  for (const row of rows) {
    const key = linkKey(row);
    if (!key) continue;
    const g = groups.get(key) ?? { charges: [], reversals: [] };
    (isLedgerReversal(row) ? g.reversals : g.charges).push(row);
    groups.set(key, g);
  }
  const cancelled = new Set<number>();
  const reversalOf = new Map<number, T>();
  for (const { charges, reversals } of groups.values()) {
    for (const rev of [...reversals].sort((a, b) => a.id - b.id)) {
      // Oldest unmatched charge first: a reversal follows its charge.
      const match = charges
        .filter((c) => !cancelled.has(c.id) && negates(rev, c))
        .sort((a, b) => a.id - b.id)[0];
      if (match) {
        cancelled.add(match.id);
        reversalOf.set(rev.id, match);
      }
    }
  }
  return { cancelled, reversalOf };
}

/** Ids of the non-reversal rows a 'Refund Reversal' row fully cancels. */
export function cancelledLedgerIds(
  rows: readonly LedgerRow[],
): ReadonlySet<number> {
  return ledgerCancellations(rows).cancelled;
}

/** A cancelled original or its matched cancellation: the pair nets to 0,
 *  so neither counts in a side's total (charged / paid). */
export function isCancelledPairRow(
  row: Pick<LedgerRow, "id">,
  c: LedgerCancellations<LedgerRow>,
): boolean {
  return c.cancelled.has(row.id) || c.reversalOf.has(row.id);
}

/** The type that decides a row's side of the account: a matched
 *  cancellation sits on its original's side (a cancelled credit deposit's
 *  reversal next to the deposit, on the Payments side). */
export function ledgerSideType(
  row: Pick<LedgerRow, "id" | "transaction_type">,
  c: LedgerCancellations<LedgerRow>,
): string {
  return c.reversalOf.get(row.id)?.transaction_type ?? row.transaction_type;
}

/** How a row reads on the account: a normal row, a charge that was voided /
 *  refunded in full, or the cancellation row itself. */
export type LedgerRowState = "normal" | "voided" | "cancellation";

export function ledgerRowState(
  row: Pick<LedgerRow, "id" | "transaction_type">,
  cancelled: ReadonlySet<number>,
): LedgerRowState {
  if (isLedgerReversal(row)) return "cancellation";
  return cancelled.has(row.id) ? "voided" : "normal";
}

/**
 * LIRA-383 (owner 2026-11-11, decision 3) — the paid / left state of one
 * charge row on a client's account history ("Purchases & Charges"), read
 * from the figures `findOpenDebtItems` already returns (the open charge's
 * `openUsd` / `openLbp`) — no second derivation of what is open.
 *
 *  - an open charge something was paid on → "paid X · left Y";
 *  - a coverable charge the open list no longer has → "Paid";
 *  - anything else (open list not loaded for this client, a refunded /
 *    voided / cancellation row, a sale, a basket, a manual entry, a payment)
 *    → null: nothing is shown, so a row is never called paid on a guess.
 */
import {
  REPAYMENT_COVERABLE_DEBT_TYPES,
  type OpenDebtItem,
} from "@liratek/core";

const SESSION_DEBT = "Session Debt";
const EPS_USD = 0.005;
const EPS_LBP = 1;

export type DebtRowPaidState =
  | { state: "paid" }
  | {
      state: "partial";
      paidUsd: number;
      paidLbp: number;
      leftUsd: number;
      leftLbp: number;
    };

export function debtRowPaidState(
  row: {
    id: number;
    transaction_type: string | null;
    amount_usd: number;
    amount_lbp: number;
  },
  /** The row is refunded, voided or a cancellation. */
  excluded: boolean,
  /** The client's open items, or null while not loaded for this client. */
  openItems: OpenDebtItem[] | null,
): DebtRowPaidState | null {
  if (openItems == null || excluded) return null;
  const type = row.transaction_type;
  if (!type || type === SESSION_DEBT) return null;
  if (!REPAYMENT_COVERABLE_DEBT_TYPES.includes(type)) return null;
  const owedUsd = Math.max(0, row.amount_usd || 0);
  const owedLbp = Math.max(0, row.amount_lbp || 0);
  if (owedUsd <= EPS_USD && owedLbp <= EPS_LBP) return null;
  const open = openItems.find((o) => o.kind === "charge" && o.id === row.id);
  if (!open) return { state: "paid" };
  const paidUsd = Math.max(0, owedUsd - open.openUsd);
  const paidLbp = Math.max(0, owedLbp - open.openLbp);
  if (paidUsd <= EPS_USD && paidLbp <= EPS_LBP) return null;
  return {
    state: "partial",
    paidUsd,
    paidLbp,
    leftUsd: open.openUsd,
    leftLbp: open.openLbp,
  };
}

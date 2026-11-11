/**
 * LIRA-384 — the ONE derivation of a transfer's commission figure on screen,
 * shared by OMT/Whish History (cell + sort) and the Suppliers Transactions
 * tab, so the pages never disagree (rule 14).
 *
 * - AT_SETTLEMENT row (`commission_model = 1`) not settled yet: the
 *   booking-time estimate, flagged as an estimate.
 * - A settled AT_SETTLEMENT row, or any settled row carrying an allocation:
 *   its share of the settlement commission (`settled_commission_usd/lbp`,
 *   joined from `settlement_commission_allocations` by `getHistory` /
 *   `getAllByProvider`) — the figure the Profits page counts. No allocation
 *   row means no share: 0, never the estimate.
 * - EMBEDDED row (`commission_model = 0`): its booked commission is final.
 */
export interface HistoryCommissionRow {
  commission: number;
  currency: string;
  commission_model?: number | null;
  is_settled: number;
  settled_commission_usd?: number | null;
  settled_commission_lbp?: number | null;
}

export type HistoryCommission =
  | { kind: "estimate"; amount: number }
  | { kind: "booked"; amount: number }
  | { kind: "settled"; usd: number; lbp: number };

export function historyCommission(tx: HistoryCommissionRow): HistoryCommission {
  const hasShare =
    tx.settled_commission_usd != null || tx.settled_commission_lbp != null;
  const atSettlement = tx.commission_model === 1;
  if (!tx.is_settled || (!atSettlement && !hasShare)) {
    return atSettlement
      ? { kind: "estimate", amount: tx.commission }
      : { kind: "booked", amount: tx.commission };
  }
  return {
    kind: "settled",
    usd: tx.settled_commission_usd ?? 0,
    lbp: tx.settled_commission_lbp ?? 0,
  };
}

/** Sort value of the cell: the share in the row's own currency first. */
export function historyCommissionSortValue(tx: HistoryCommissionRow): number {
  const c = historyCommission(tx);
  if (c.kind !== "settled") return c.amount;
  const own = tx.currency === "LBP" ? c.lbp : c.usd;
  return own !== 0 ? own : tx.currency === "LBP" ? c.usd : c.lbp;
}

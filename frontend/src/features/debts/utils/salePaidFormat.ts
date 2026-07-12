/**
 * Display helpers for the Sale Details modal (Debts page).
 *
 * A sale's paid amounts are two independent currency buckets; rendering both
 * unconditionally produced "$0.00 + 360,000 LBP" for an LBP-only payment.
 * Only non-zero parts are shown; a fully unpaid sale reads "$0.00".
 */
export function formatPaidAmount(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
  if (lbp > 0) parts.push(`${lbp.toLocaleString()} LBP`);
  return parts.length ? parts.join(" + ") : "$0.00";
}

/**
 * Outstanding balance in USD: final amount minus everything paid, with LBP
 * converted at the sale's snapshot rate — the same math as the core
 * fully-paid gate and the debt-repayment allocator (DebtRepository). Clamped
 * at 0 so rate rounding never renders a negative debt.
 */
export function saleOutstandingUsd(sale: {
  final_amount_usd?: number;
  total_amount_usd?: number;
  paid_usd?: number;
  paid_lbp?: number;
  exchange_rate_snapshot?: number;
}): number {
  const final = sale.final_amount_usd || sale.total_amount_usd || 0;
  const rate = sale.exchange_rate_snapshot || 0;
  const paid =
    (sale.paid_usd || 0) + (rate > 0 ? (sale.paid_lbp || 0) / rate : 0);
  return Math.max(0, final - paid);
}

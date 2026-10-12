/**
 * USD and LBP totals of a list of expenses, kept separate (never converted).
 *
 * A row refunded from the Transactions page (`is_refunded`) is left out: its
 * money was already returned, matching Profits and the closing report
 * (LIRA-185 expenses lead 1). The page header and the History window both
 * use this, so the two totals can never disagree on what counts.
 */
export function expenseTotals(
  expenses: ReadonlyArray<{
    amount_usd?: number;
    amount_lbp?: number;
    is_refunded?: number;
  }>,
): { totalUSD: number; totalLBP: number } {
  let totalUSD = 0;
  let totalLBP = 0;
  for (const e of expenses) {
    if (e.is_refunded) continue;
    totalUSD += e.amount_usd || 0;
    totalLBP += e.amount_lbp || 0;
  }
  return { totalUSD, totalLBP };
}

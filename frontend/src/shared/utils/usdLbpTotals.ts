/**
 * USD and LBP totals of a History window's rows, kept separate (never
 * converted). `pick` returns one row's USD and LBP value; each window decides
 * which of its amounts that is.
 *
 * A row refunded (`is_refunded`) is left out: its money was returned. Every
 * History window and the Expenses page header use this one rule (rule 14).
 */
export function usdLbpTotals<T extends { is_refunded?: number | null }>(
  rows: ReadonlyArray<T>,
  pick: (row: T) => { usd: number; lbp: number },
): { usd: number; lbp: number } {
  let usd = 0;
  let lbp = 0;
  for (const row of rows) {
    if (row.is_refunded) continue;
    const v = pick(row);
    usd += Number(v.usd) || 0;
    lbp += Number(v.lbp) || 0;
  }
  return { usd, lbp };
}

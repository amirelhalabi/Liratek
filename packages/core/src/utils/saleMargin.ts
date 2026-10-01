/**
 * LIRA-184 (rule 14) — the sale item's gross margin expression
 * `(unitPrice - unitCost) * quantity` was hand-copied at several call
 * sites across the profit surface. By the time this ticket was picked up,
 * the audit's three "ignores quantity" copies were ALREADY gone:
 * `ClosingRepository.ts` stopped computing profit at all (LIRA-219 — it now
 * reads `ProfitService.getSummary`) and `SalesRepository`'s old chart-data
 * query (the un-qty'd `SUM(sold_price_usd - cost_price_snapshot_usd)`) was
 * removed by the DC-10 refactor in favour of composing
 * `ProfitService.getByDate` — see the doc comment at
 * `SalesRepository.ts` above `getChartData`. `FinancialRepository.ts` is
 * now a 45-line stub with no profit logic.
 *
 * What remained was two LIVE TypeScript call sites — `processSale`'s
 * provisional per-item pass and `_computeSaleItemRefundAmounts`'s gross
 * margin step — that both still hand-wrote the identical, already-correct
 * `(price - cost) * quantity` subexpression. Neither was wrong (both
 * already multiplied by quantity), so this is a pure rule-14
 * deduplication, not a bug fix: one named, pure function (no I/O — rule
 * 13/29 safe for either `@liratek/core` entry point) replacing both
 * hand-written copies so they can never diverge from each other.
 *
 * Example: 3 units at $10 each, $6 cost each → margin = (10 - 6) * 3 = 12,
 * i.e. 12 / 30 = 40% of revenue.
 */
export function lineGrossMarginUsd(
  unitPriceUsd: number,
  unitCostUsd: number,
  quantity: number,
): number {
  return (unitPriceUsd - unitCostUsd) * quantity;
}

import type { CurrencyRate } from "@liratek/core";
import { marketRateToUsdPerUnit, unrealizedProfitUsd } from "@liratek/core";

/** One Open Positions row, as `exchangeLots.getPositions()` returns it. */
export interface PositionRow {
  currency_code: string;
  open_qty: number;
  avg_unit_cost_usd: number;
  lot_count: number;
  current_market_unit_usd: number | null;
  unrealized_profit_usd: number | null;
}

/**
 * LIRA-404 — the ONE rule for filling the Open Positions panel's Market (USD)
 * and Unrealized P&L from the online feed (rule 14).
 *
 * The server fills both only when the shop has a Settings rate row for the
 * currency; every feed currency (EUR since v235, GBP, CAD …) comes back
 * `null`. For those, take today's market from the feed snapshot the Exchange
 * page already holds, using the same orientation and unrealized formulas the
 * server uses (`marketRateToUsdPerUnit`, `unrealizedProfitUsd`).
 *
 * - A value the server sent is never overwritten.
 * - No feed, or the feed lacks the currency, or a broken rate → the row stays
 *   `null` and the panel keeps its "—".
 * - Display only: never saved, never fed into Profits.
 */
export function fillPositionsMarketFromFeed(
  positions: PositionRow[],
  marketRates: CurrencyRate[],
): PositionRow[] {
  if (marketRates.length === 0) return positions;
  return positions.map((p) => {
    if (p.current_market_unit_usd !== null) return p;
    const feed = marketRates.find((r) => r.to_code === p.currency_code);
    if (!feed || !Number.isFinite(feed.market_rate) || feed.market_rate <= 0) {
      return p;
    }
    const market = marketRateToUsdPerUnit(feed.market_rate, feed.is_stronger);
    return {
      ...p,
      current_market_unit_usd: market,
      unrealized_profit_usd: unrealizedProfitUsd(
        p.open_qty,
        market,
        p.avg_unit_cost_usd,
      ),
    };
  });
}

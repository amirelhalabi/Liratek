/**
 * LIRA-404 — Open Positions: when the server leaves Market (USD) and
 * Unrealized P&L blank (no Settings rate row — EUR, GBP, CAD …), the panel
 * fills them from the online feed snapshot. Display only. Server values are
 * never overwritten; a currency the feed lacks (or no feed at all) stays
 * blank so the panel keeps its "—".
 */
import type { CurrencyRate } from "@liratek/core";
import {
  fillPositionsMarketFromFeed,
  type PositionRow,
} from "../positionsMarket";

const eurFeed: CurrencyRate = {
  to_code: "EUR",
  market_rate: 1 / 0.8, // feed: 1 USD = 0.8 EUR → 1.25 USD per EUR
  buy_rate: 1 / 0.8,
  sell_rate: 1 / 0.8,
  is_stronger: -1,
};
const tryFeed: CurrencyRate = {
  to_code: "TRY",
  market_rate: 40, // 1 USD = 40 TRY → 0.025 USD per TRY
  buy_rate: 40,
  sell_rate: 40,
  is_stronger: 1,
};

const blank = (code: string, qty: number, avg: number): PositionRow => ({
  currency_code: code,
  open_qty: qty,
  avg_unit_cost_usd: avg,
  lot_count: 1,
  current_market_unit_usd: null,
  unrealized_profit_usd: null,
});

describe("fillPositionsMarketFromFeed", () => {
  it("fills a blank row from the feed, for a stronger (EUR) and a weaker (TRY) currency", () => {
    const [eur, tr] = fillPositionsMarketFromFeed(
      [blank("EUR", 100, 1.16), blank("TRY", 4000, 0.024)],
      [eurFeed, tryFeed],
    );
    expect(eur.current_market_unit_usd).toBeCloseTo(1.25, 10);
    expect(eur.unrealized_profit_usd).toBeCloseTo(9, 10); // 100 × (1.25 − 1.16)
    expect(tr.current_market_unit_usd).toBeCloseTo(0.025, 10);
    expect(tr.unrealized_profit_usd).toBeCloseTo(4, 10); // 4000 × 0.001
  });

  it("never overwrites a value the server already sent", () => {
    const server: PositionRow = {
      ...blank("EUR", 100, 1.16),
      current_market_unit_usd: 1.18,
      unrealized_profit_usd: 2,
    };
    expect(fillPositionsMarketFromFeed([server], [eurFeed])).toEqual([server]);
  });

  it("keeps the row blank when the feed is unavailable or lacks the currency", () => {
    const row = blank("GBP", 50, 1.3);
    expect(fillPositionsMarketFromFeed([row], [])).toEqual([row]);
    expect(fillPositionsMarketFromFeed([row], [eurFeed])).toEqual([row]);
  });

  it("ignores a broken feed rate (zero / not a number)", () => {
    const row = blank("EUR", 10, 1.1);
    const broken = { ...eurFeed, market_rate: 0 };
    expect(fillPositionsMarketFromFeed([row], [broken])).toEqual([row]);
    const nan = { ...eurFeed, market_rate: Number.NaN };
    expect(fillPositionsMarketFromFeed([row], [nan])).toEqual([row]);
  });
});

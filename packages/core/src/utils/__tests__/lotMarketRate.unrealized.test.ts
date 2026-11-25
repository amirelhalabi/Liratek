/**
 * LIRA-404 — the ONE unrealized-P&L formula (rule 14), shared by
 * `ExchangeLotService.getPositions` (server row) and the Open Positions panel
 * (feed fill). Indicative display math, rounded to the cent.
 */
import * as lotMarketRate from "../lotMarketRate";

type Fn = (
  openQty: number,
  marketUnitUsd: number,
  avgUnitCostUsd: number,
) => number;

describe("unrealizedProfitUsd", () => {
  const fn = (lotMarketRate as unknown as { unrealizedProfitUsd?: Fn })
    .unrealizedProfitUsd;

  it("is exported from the browser-safe lotMarketRate module", () => {
    expect(typeof fn).toBe("function");
  });

  it("is open quantity × (market − average cost), rounded to the cent", () => {
    expect(fn!(100, 1.18, 1.16)).toBeCloseTo(2, 10);
    expect(fn!(250, 1.3412, 1.35)).toBeCloseTo(-2.2, 10);
    expect(fn!(33.333, 1.0789, 1.05)).toBeCloseTo(0.96, 10);
  });
});

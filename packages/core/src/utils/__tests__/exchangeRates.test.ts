/** LIRA-302 — the shared USD/LBP rate reader (web keeps its fallback; the phone gets null). */
import { readUsdLbpRates } from "../exchangeRates";

describe("readUsdLbpRates", () => {
  it("reads the current schema's LBP row, buy/sell falling back to market", () => {
    expect(readUsdLbpRates([{ to_code: "LBP", market_rate: 89_500, buy_rate: 89_000, sell_rate: 90_000 }])).toEqual({
      buyRate: 89_000,
      sellRate: 90_000,
    });
    expect(readUsdLbpRates([{ to_code: "LBP", market_rate: 89_500, buy_rate: null, sell_rate: null }])).toEqual({
      buyRate: 89_500,
      sellRate: 89_500,
    });
  });

  it("reads the legacy from/to rows", () => {
    const legacy = [
      { from_code: "LBP", to_code: "USD", rate: 88_000 },
      { from_code: "USD", to_code: "LBP", rate: 88_600 },
    ];
    expect(readUsdLbpRates(legacy)).toEqual({ buyRate: 88_000, sellRate: 88_600 });
  });

  it("with a fallback behaves as the web always did", () => {
    expect(readUsdLbpRates([], 89_000)).toEqual({ buyRate: 89_000, sellRate: 89_500 });
  });

  it("without a fallback returns null when there is no buy rate (the phone turns USD off)", () => {
    expect(readUsdLbpRates([])).toBeNull();
    expect(readUsdLbpRates([{ to_code: "EUR", market_rate: 1.1 }])).toBeNull();
  });
});

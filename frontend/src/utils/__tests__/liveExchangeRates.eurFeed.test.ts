/**
 * LIRA-404 — the euro is a feed currency now (like GBP/CAD): it is no longer
 * excluded from the online feed, and it keeps its first place in the
 * currency picker. LBP stays the shop's own typed rate.
 */
import {
  EXCLUDED_CURRENCIES,
  fetchLiveRatesSnapshot,
} from "@/utils/liveExchangeRates";

describe("liveExchangeRates — EUR from the feed", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("excludes only USD and LBP", () => {
    expect([...EXCLUDED_CURRENCIES].sort()).toEqual(["LBP", "USD"]);
  });

  it("puts EUR in the exchange list, first, at buy = sell = market", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: "success",
        base_code: "USD",
        time_last_update_utc: "Tue, 25 Nov 2026 00:02:31 +0000",
        time_next_update_unix: Math.floor(Date.now() / 1000) + 3600,
        rates: { USD: 1, LBP: 89500, AUD: 1.5, GBP: 0.75, EUR: 0.8 },
      }),
    }) as unknown as typeof fetch;

    const snap = await fetchLiveRatesSnapshot();
    const codes = snap.rates.map((r) => r.to_code);
    expect(codes).not.toContain("LBP");
    expect(codes).not.toContain("USD");
    expect(codes[0]).toBe("EUR");
    const eur = snap.rates[0];
    expect(eur.is_stronger).toBe(-1);
    expect(eur.market_rate).toBeCloseTo(1.25, 10);
    expect(eur.buy_rate).toBe(eur.market_rate);
    expect(eur.sell_rate).toBe(eur.market_rate);
  });
});

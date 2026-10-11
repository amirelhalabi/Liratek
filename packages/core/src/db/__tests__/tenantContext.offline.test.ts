/**
 * LIRA-306 T015 — `runWithTenant(t, fn, { effectiveNow, effectiveRates })`:
 * the replay's "effective now" and recorded exchange rates travel in the
 * tenant context like `clientDay` does (rule 27 — the event says when and at
 * which rate, never the server's clock or today's rate).
 */
import {
  runWithTenant,
  getContextEffectiveNow,
  getContextEffectiveRates,
} from "../tenantContext";

const RATES = [{ to_code: "LBP", market_rate: 90000, buy_rate: 89500, sell_rate: 90000, is_stronger: 1 as const }];

describe("tenant context — effectiveNow / effectiveRates", () => {
  it("carries both for the async extent of fn", async () => {
    await runWithTenant(
      7,
      async () => {
        await Promise.resolve();
        expect(getContextEffectiveNow()).toBe("2026-10-10T20:50:00.000Z");
        expect(getContextEffectiveRates()).toEqual(RATES);
      },
      { effectiveNow: "2026-10-10T20:50:00.000Z", effectiveRates: RATES },
    );
  });

  it("is undefined outside a scope or when not given", () => {
    expect(getContextEffectiveNow()).toBeUndefined();
    expect(getContextEffectiveRates()).toBeUndefined();
    runWithTenant(7, () => {
      expect(getContextEffectiveNow()).toBeUndefined();
      expect(getContextEffectiveRates()).toBeUndefined();
    });
  });

  it("drops an invalid instant instead of throwing", () => {
    runWithTenant(7, () => expect(getContextEffectiveNow()).toBeUndefined(), { effectiveNow: "yesterday" });
  });
});

/**
 * LIRA-310 — one shortfall cap shared by the Waive button and payout kept
 * change (owner decisions 2026-10-11): $5 for a USD total, 450,000 LBP for
 * an LBP total, UP TO AND INCLUDING the cap, in the total's own currency.
 */
import {
  SHORTFALL_MAX,
  PAYOUT_KEEP_CHANGE_MAX,
  isWithinShortfallMax,
} from "../exchange.js";

describe("SHORTFALL_MAX (LIRA-310)", () => {
  it("is $5 / 450,000 LBP", () => {
    expect(SHORTFALL_MAX).toEqual({ USD: 5, LBP: 450_000 });
  });

  it("payout kept change uses the same cap", () => {
    expect(PAYOUT_KEEP_CHANGE_MAX).toEqual(SHORTFALL_MAX);
  });

  it.each([
    [5, "USD", true],
    [4.99, "USD", true],
    [5.01, "USD", false],
    [450_000, "LBP", true],
    [450_001, "LBP", false],
    [0.5, "USD", true],
    [1, "EUR", false],
    [-1, "USD", false],
  ])("isWithinShortfallMax(%p, %p) → %p", (amount, currency, expected) => {
    expect(isWithinShortfallMax(amount, currency)).toBe(expected);
  });
});

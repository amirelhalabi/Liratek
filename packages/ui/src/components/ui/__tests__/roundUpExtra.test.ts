/**
 * suggestRoundUpExtra (LIRA-334, research R7) — the one rule both the
 * payment box's built-in Extra line and the POS/Maintenance checkout use to
 * turn a small customer overpay into an extra charge.
 *
 * Rule 17: run against a stub that returns 0 first — see the task report.
 */

import { matchToleranceFor, suggestRoundUpExtra } from "../roundUpExtra";

describe("suggestRoundUpExtra", () => {
  it("$103 paid on $102.90 → 0.10 (rounded to cents)", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 103,
        baseTotalInTarget: 102.9,
        currency: "USD",
      }),
    ).toBe(0.1);
  });

  it("no overpay → 0", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 102.9,
        baseTotalInTarget: 102.9,
        currency: "USD",
      }),
    ).toBe(0);
  });

  it("underpaid → 0", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 100,
        baseTotalInTarget: 102.9,
        currency: "USD",
      }),
    ).toBe(0);
  });

  it("an overpay within the match tolerance (the payment box shows no change) → 0", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 102.91,
        baseTotalInTarget: 102.9,
        currency: "USD",
      }),
    ).toBe(0);
    expect(
      suggestRoundUpExtra({
        paidInTarget: 1_000_100,
        baseTotalInTarget: 1_000_000,
        currency: "LBP",
      }),
    ).toBe(0);
  });

  it("exactly $5 (the cap is inclusive) → 5", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 107.9,
        baseTotalInTarget: 102.9,
        currency: "USD",
      }),
    ).toBe(5);
  });

  it("overpay $6 (over the $5 cap) → 0", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 108.9,
        baseTotalInTarget: 102.9,
        currency: "USD",
      }),
    ).toBe(0);
  });

  it("LBP 5,000 → 5,000 (whole pounds)", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 9_000_000.4,
        baseTotalInTarget: 8_995_000,
        currency: "LBP",
      }),
    ).toBe(5_000);
  });

  it("LBP over 450,000 → 0", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 9_450_001,
        baseTotalInTarget: 9_000_000,
        currency: "LBP",
      }),
    ).toBe(0);
  });

  it("above the page's extra cap → 0", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 3,
        baseTotalInTarget: 1,
        currency: "USD",
        cap: 1,
      }),
    ).toBe(0);
  });

  it("a currency with no shortfall cap → 0", () => {
    expect(
      suggestRoundUpExtra({
        paidInTarget: 11,
        baseTotalInTarget: 10,
        currency: "EUR",
      }),
    ).toBe(0);
  });

  it("matchToleranceFor matches the payment box (100 LBP, 0.01 otherwise)", () => {
    expect(matchToleranceFor("LBP")).toBe(100);
    expect(matchToleranceFor("USD")).toBe(0.01);
  });
});

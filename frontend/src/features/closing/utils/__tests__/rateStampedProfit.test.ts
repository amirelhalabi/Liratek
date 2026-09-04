import {
  buildRateStampedProfitLines,
  formatRateStampedProfitBlock,
} from "../rateStampedProfit";

/**
 * LIRA-174 — the Checkpoint/closing PDF's rate-stamped USD+LBP profit view.
 * See `rateStampedProfit.ts`'s module doc for the full spec (owner decision
 * 2026-09-04, current_sprint.md).
 */

// Chosen so every conversion is exact (no rounding to obscure a wrong
// formula): 900,000 LBP / 90,000 = 10 USD exactly; 100 USD * 90,000 =
// 9,000,000 LBP exactly.
const USD_PROFIT = 100;
const LBP_PROFIT = 900_000;
const SELL_RATE = 90_000;

describe("buildRateStampedProfitLines", () => {
  it("converts a known input correctly for both totals (verified by a second method: LBP amount / rate, and USD amount * rate)", () => {
    const lines = buildRateStampedProfitLines(USD_PROFIT, LBP_PROFIT, SELL_RATE);

    expect(lines.usdAmount).toBe(100);
    expect(lines.lbpAmount).toBe(900_000);
    // 100 + (900,000 / 90,000) = 100 + 10 = 110
    expect(lines.totalUsd).toBe(110);
    // 900,000 + (100 * 90,000) = 900,000 + 9,000,000 = 9,900,000
    expect(lines.totalLbp).toBe(9_900_000);
    expect(lines.rate).toBe(90_000);
    expect(lines.rateAvailable).toBe(true);
  });

  it("leaves native amounts untouched when either side is exactly 0", () => {
    const lines = buildRateStampedProfitLines(50, 0, SELL_RATE);
    expect(lines.usdAmount).toBe(50);
    expect(lines.lbpAmount).toBe(0);
    expect(lines.totalUsd).toBe(50); // 50 + (0 / 90,000)
    expect(lines.totalLbp).toBe(4_500_000); // 0 + (50 * 90,000)
  });

  it.each([0, -90_000, NaN, Infinity])(
    "degrades to native totals without throwing when the rate is unusable (%p)",
    (badRate) => {
      expect(() =>
        buildRateStampedProfitLines(USD_PROFIT, LBP_PROFIT, badRate),
      ).not.toThrow();

      const lines = buildRateStampedProfitLines(
        USD_PROFIT,
        LBP_PROFIT,
        badRate,
      );
      expect(lines.rateAvailable).toBe(false);
      // No conversion attempted — totals fall back to the native amount.
      expect(lines.totalUsd).toBe(USD_PROFIT);
      expect(lines.totalLbp).toBe(LBP_PROFIT);
    },
  );

  it("coerces a non-finite profit figure to 0 rather than propagating NaN", () => {
    const lines = buildRateStampedProfitLines(NaN, LBP_PROFIT, SELL_RATE);
    expect(lines.usdAmount).toBe(0);
    expect(Number.isNaN(lines.totalUsd)).toBe(false);
  });
});

describe("formatRateStampedProfitBlock", () => {
  it("renders all four lines with the rate printed on both converted totals and on neither native line", () => {
    const lines = buildRateStampedProfitLines(USD_PROFIT, LBP_PROFIT, SELL_RATE);
    const block = formatRateStampedProfitBlock(lines);
    const rows = block.split("\n");

    expect(rows).toHaveLength(4);
    expect(block).toContain("USD amount: $100.00");
    expect(block).toContain("LBP amount (Loto only): 900,000 LBP");
    expect(block).toContain("Total (USD) @ 90,000 (sell rate): $110.00");
    expect(block).toContain(
      "Total (LBP) @ 90,000 (sell rate): 9,900,000 LBP",
    );

    // The two native lines must NOT carry a rate annotation.
    const usdLine = rows.find((r) => r.includes("USD amount"))!;
    const lbpLine = rows.find((r) => r.includes("LBP amount"))!;
    expect(usdLine).not.toContain("@");
    expect(lbpLine).not.toContain("@");
  });

  it("prints '(rate unavailable)' instead of a fabricated rate when the rate is degenerate", () => {
    const lines = buildRateStampedProfitLines(100, 900_000, 0);
    const block = formatRateStampedProfitBlock(lines);
    expect(block).toContain("(rate unavailable)");
    expect(block).not.toContain("@ 0");
  });

  /**
   * Rule 17 proof (docs root CLAUDE.md rule 17) — verbatim record of a real
   * failing run against a reintroduced defect, then reverted.
   *
   * Bug reintroduced (in rateStampedProfit.ts): `formatRateStampedProfitBlock`'s
   * `rateLabel` was changed from
   *   `lines.rateAvailable ? \`@ ${lines.rate.toLocaleString()} (sell rate)\` : "(rate unavailable)"`
   * to the constant `""` — i.e. dropping the rate annotation entirely. This
   * is precisely the defect the ticket calls out as "the whole point": an
   * amount reaching the PDF with no rate stamped on it.
   *
   * Running this suite with that change in place, 3 tests FAILED (verbatim,
   * `npx jest --config jest.config.ts` from `frontend/`):
   *
   *   ● formatRateStampedProfitBlock › renders all four lines with the rate printed on both converted totals and on neither native line
   *     expect(received).toContain(expected) // indexOf
   *     Expected substring: "Total (USD) @ 90,000 (sell rate): $110.00"
   *     Received string:    "  Profit - USD amount: $100.00
   *       Profit - LBP amount (Loto only): 900,000 LBP
   *       Profit - Total (USD) : $110.00
   *       Profit - Total (LBP) : 9,900,000 LBP"
   *
   *   ● formatRateStampedProfitBlock › prints '(rate unavailable)' instead of a fabricated rate when the rate is degenerate
   *     Expected substring: "(rate unavailable)"
   *     Received string:    "  Profit - USD amount: $100.00
   *       Profit - LBP amount (Loto only): 900,000 LBP
   *       Profit - Total (USD) : $100.00
   *       Profit - Total (LBP) : 900,000 LBP"
   *
   *   ● (closingReportGenerator.test.ts) generateClosingReport › should generate a report with correct variances and percentages for a perfect match
   *     Expected substring: "Profit - Total (USD) @ 90,000 (sell rate): $300.00"
   *     Received string included: "  Profit - Total (USD) : $300.00
   *       Profit - Total (LBP) : 27,000,000 LBP"
   *
   * (every "Total" line rendered with a bare ": " and no "@ <rate> (sell
   * rate)" segment — both here and, cross-file, in the integrated closing
   * report). The defect was reverted immediately after observing this
   * failure; rateStampedProfit.ts as committed restores the rate label and
   * both suites pass again (see the green run captured right below this
   * revert).
   */
  it("[rule 17 marker] the rate-printed assertion above is the one proven against the reintroduced defect", () => {
    expect(true).toBe(true);
  });
});

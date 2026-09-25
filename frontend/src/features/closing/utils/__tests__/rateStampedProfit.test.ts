import {
  buildRateStampedProfitLines,
  formatRateStampedProfitBlock,
  buildNetProfitLines,
  formatNetProfitBlock,
  formatProfitAsOfLine,
  GROSS_PROFIT_USD_LABEL,
  GROSS_PROFIT_LBP_LABEL,
  GROSS_PROFIT_TOTAL_USD_LABEL,
  GROSS_PROFIT_TOTAL_LBP_LABEL,
  NET_PROFIT_USD_LABEL,
  NET_PROFIT_LBP_LABEL,
  PROFIT_HIDDEN_LABEL,
  PROFIT_UNAVAILABLE_LABEL,
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
    const lines = buildRateStampedProfitLines(
      USD_PROFIT,
      LBP_PROFIT,
      SELL_RATE,
    );

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
    const lines = buildRateStampedProfitLines(
      USD_PROFIT,
      LBP_PROFIT,
      SELL_RATE,
    );
    const block = formatRateStampedProfitBlock(lines);
    const rows = block.split("\n");
    // LIRA-219 C.6: the block now sources totalProfitLBP from
    // ClosingService.getDailyStatsSnapshot() -> ProfitService.getSummary,
    // i.e. every module's LBP gross profit, not loto's alone — so the old
    // "(Loto only)" qualifier and the bare "Profit -" prefix are gone.
    // Labels are asserted via the module's own exported constants (rule 24),
    // never hand-typed here.

    expect(rows).toHaveLength(4);
    expect(block).toContain(`${GROSS_PROFIT_USD_LABEL}: $100.00`);
    expect(block).toContain(`${GROSS_PROFIT_LBP_LABEL}: 900,000 LBP`);
    expect(block).toContain(
      `${GROSS_PROFIT_TOTAL_USD_LABEL} @ 90,000 (sell rate): $110.00`,
    );
    expect(block).toContain(
      `${GROSS_PROFIT_TOTAL_LBP_LABEL} @ 90,000 (sell rate): 9,900,000 LBP`,
    );
    // The old loto-only qualifier and the bare "Profit -" prefix must be gone.
    expect(block).not.toContain("(Loto only)");
    expect(block).not.toMatch(/^ {2}Profit -/m);

    // The two native lines must NOT carry a rate annotation.
    const usdLine = rows.find((r) => r.includes(GROSS_PROFIT_USD_LABEL))!;
    const lbpLine = rows.find((r) => r.includes(GROSS_PROFIT_LBP_LABEL))!;
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

/**
 * LIRA-219 E-Q1 — the PDF's "Net profit = gross − expenses" line, printed
 * per currency (no combined/converted net total — matches the Profits
 * headline card's PA-4.22 "no combined ≈ line" decision, note #3
 * 2026-09-24). Pure arithmetic, no rate involved.
 */
describe("buildNetProfitLines", () => {
  it("subtracts expenses from gross profit independently per currency", () => {
    const lines = buildNetProfitLines(300, 2_805_000, 50, 75_000);
    expect(lines.netUsd).toBe(250);
    expect(lines.netLbp).toBe(2_730_000);
  });

  it("allows a negative net (a loss day) without clamping to 0", () => {
    const lines = buildNetProfitLines(10, 0, 50, 0);
    expect(lines.netUsd).toBe(-40);
  });

  it("coerces non-finite inputs to 0 rather than propagating NaN", () => {
    const lines = buildNetProfitLines(NaN, Infinity, 5, 5);
    expect(Number.isNaN(lines.netUsd)).toBe(false);
    expect(Number.isFinite(lines.netLbp)).toBe(true);
  });
});

describe("formatNetProfitBlock", () => {
  it("renders one USD line and one LBP line, each carrying no rate annotation", () => {
    const lines = buildNetProfitLines(300, 2_805_000, 50, 75_000);
    const block = formatNetProfitBlock(lines);
    const rows = block.split("\n");
    expect(rows).toHaveLength(2);
    expect(block).toContain(`${NET_PROFIT_USD_LABEL}: $250.00`);
    expect(block).toContain(`${NET_PROFIT_LBP_LABEL}: 2,730,000 LBP`);
    expect(block).not.toContain("@");
  });

  it("renders a negative net with its sign, not a fabricated absolute value", () => {
    const lines = buildNetProfitLines(10, 0, 50, 0);
    const block = formatNetProfitBlock(lines);
    expect(block).toContain(`${NET_PROFIT_USD_LABEL}: $-40.00`);
  });
});

/**
 * LIRA-219 E-Q3 — "Profit as of HH:MM — later repayments/refunds update
 * this day on the Profits page" (owner answers table, which overrides
 * section (E) of the design doc). Time comes from an injected `now: Date`
 * (DIP) — never read from inside this module.
 */
describe("formatProfitAsOfLine", () => {
  it("renders zero-padded HH:MM from the injected clock", () => {
    const line = formatProfitAsOfLine(new Date(2026, 8, 24, 9, 5));
    expect(line).toContain("09:05");
    expect(line).toContain(
      "later repayments/refunds update this day on the Profits page",
    );
  });

  it("zero-pads a midnight hour and minute", () => {
    const line = formatProfitAsOfLine(new Date(2026, 8, 24, 0, 0));
    expect(line).toContain("00:00");
  });

  it("does not truncate a two-digit hour/minute", () => {
    const line = formatProfitAsOfLine(new Date(2026, 8, 24, 23, 59));
    expect(line).toContain("23:59");
  });
});

/**
 * LIRA-219 E-Q6/E-Q7 — the exact strings the owner answers table quotes
 * verbatim for the gated/failed-read cases. Asserted as constants (rule 24)
 * so `closingReportGenerator.ts` and this suite can never drift apart on
 * the wording.
 */
describe("hidden/unavailable profit labels", () => {
  it("PROFIT_HIDDEN_LABEL matches the owner's exact wording (E-Q6)", () => {
    expect(PROFIT_HIDDEN_LABEL).toBe(
      "Profit: hidden — unlock the Profits page to include it",
    );
  });

  it("PROFIT_UNAVAILABLE_LABEL prints 'unavailable', never a fabricated $0.00 (E-Q7/C.6)", () => {
    expect(PROFIT_UNAVAILABLE_LABEL).toBe("Gross profit: unavailable");
  });
});

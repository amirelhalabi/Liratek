// src/utils/__tests__/closingReportGenerator.test.ts
import type { DailyStatsSnapshot } from "@liratek/core";
import { generateClosingReport } from "../closingReportGenerator";
import {
  GROSS_PROFIT_USD_LABEL,
  GROSS_PROFIT_LBP_LABEL,
  GROSS_PROFIT_TOTAL_USD_LABEL,
  GROSS_PROFIT_TOTAL_LBP_LABEL,
  NET_PROFIT_USD_LABEL,
  NET_PROFIT_LBP_LABEL,
  PROFIT_HIDDEN_LABEL,
  PROFIT_UNAVAILABLE_LABEL,
} from "../rateStampedProfit";

// Fixed print-time clock (LIRA-219 E-Q3, DIP) — 14:30 local. Never read the
// system clock from inside generateClosingReport; it must be injected.
const FIXED_NOW = new Date(2023, 11, 16, 14, 30);

// `DailyStatsSnapshot` is THE pinned LIRA-219 contract type, imported from
// @liratek/core (rule 21) — never hand-copied here.
const mockDailyStats: DailyStatsSnapshot = {
  salesCount: 10,
  totalSalesUSD: 1000,
  totalSalesLBP: 1500000,
  debtPaymentsUSD: 100,
  debtPaymentsLBP: 150000,
  totalExpensesUSD: 50,
  totalExpensesLBP: 75000,
  profitDay: "2023-12-16",
  totalProfitUSD: 300,
  // Deliberately omitted (like the pre-LIRA-219 fixture): exercises the same
  // "?? 0" default path buildRateStampedProfitLines already covers.
};

describe("generateClosingReport", () => {
  it("should generate a report with correct variances and percentages for a perfect match", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "General Drawer",
      physical: {} as Record<string, number>,
      systemExpected: {} as Record<string, number>,
      physical_usd: 1000,
      physical_lbp: 1500000,
      physical_eur: 50,
      system_expected_usd: 1000,
      system_expected_lbp: 1500000,
      system_expected_eur: 50,
    };

    const report = generateClosingReport(
      closingData,
      mockDailyStats,
      90000,
      FIXED_NOW,
    );

    expect(report).toContain("--- Daily Closing Report ---");
    expect(report).toContain("Date: 2023-12-16");
    expect(report).toContain("Drawer: General Drawer");

    expect(report).toContain("Physical Count (USD): 1000.00");
    expect(report).toContain("System Expected (USD): 1000.00");
    expect(report).toContain(
      "Variance (USD): 0.00 USD (0.00%) - Perfect Match",
    );

    expect(report).toContain("Physical Count (LBP): 1,500,000");
    expect(report).toContain("System Expected (LBP): 1,500,000");
    expect(report).toContain(
      "Variance (LBP): 0.00 LBP (0.00%) - Perfect Match",
    );

    expect(report).toContain("Physical Count (EUR): 50.00");
    expect(report).toContain("System Expected (EUR): 50.00");
    expect(report).toContain(
      "Variance (EUR): 0.00 EUR (0.00%) - Perfect Match",
    );

    expect(report).toContain("--- Daily Statistics Snapshot ---");
    expect(report).toContain("Sales Count: 10");
    expect(report).toContain("Total Sales (USD): 1000.00");
    expect(report).toContain("Total Sales (LBP): 1,500,000");
    expect(report).toContain("Debt Payments (USD): 100.00");
    expect(report).toContain("Debt Payments (LBP): 150,000");
    expect(report).toContain("Total Expenses (USD): 50.00");
    expect(report).toContain("Total Expenses (LBP): 75,000");

    // LIRA-219 C.6: gross profit block, relabeled ("Gross profit -", no
    // "(Loto only)" — totalProfitLBP now covers every module's LBP gross
    // profit for the day, sourced from ProfitService.getSummary via
    // ClosingService). totalProfitLBP is absent on mockDailyStats, so it
    // defaults to 0 — verified by hand: lbpAsUsd = 0 / 90,000 = 0;
    // totalUsd = 300 + 0 = 300; usdAsLbp = 300 * 90,000 = 27,000,000;
    // totalLbp = 0 + 27,000,000. Labels come from rateStampedProfit.ts's own
    // exported constants (rule 24), never hand-typed here.
    expect(report).toContain(`${GROSS_PROFIT_USD_LABEL}: $300.00`);
    expect(report).toContain(`${GROSS_PROFIT_LBP_LABEL}: 0 LBP`);
    expect(report).toContain(
      `${GROSS_PROFIT_TOTAL_USD_LABEL} @ 90,000 (sell rate): $300.00`,
    );
    expect(report).toContain(
      `${GROSS_PROFIT_TOTAL_LBP_LABEL} @ 90,000 (sell rate): 27,000,000 LBP`,
    );
    expect(report).not.toContain("(Loto only)");

    // LIRA-219 E-Q1: Net profit = gross − expenses, per currency, no rate.
    // USD: 300 − 50 = 250. LBP: 0 − 75,000 = −75,000 (a real scenario: a
    // module can have zero LBP gross profit for the day while still having
    // LBP expenses).
    expect(report).toContain(`${NET_PROFIT_USD_LABEL}: $250.00`);
    expect(report).toContain(`${NET_PROFIT_LBP_LABEL}: -75,000 LBP`);

    // LIRA-219 E-Q3: "Profit as of HH:MM — ..." from the injected clock.
    expect(report).toContain("Profit as of 14:30");
    expect(report).toContain(
      "later repayments/refunds update this day on the Profits page",
    );

    // The gate/failure labels must NOT appear when profit was included.
    expect(report).not.toContain(PROFIT_HIDDEN_LABEL);
    expect(report).not.toContain(PROFIT_UNAVAILABLE_LABEL);
  });

  it("should generate a report with correct variances and percentages for a deficit", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "OMT Drawer",
      physical: {} as Record<string, number>,
      systemExpected: {} as Record<string, number>,
      physical_usd: 900,
      physical_lbp: 1400000,
      physical_eur: 45,
      system_expected_usd: 1000,
      system_expected_lbp: 1500000,
      system_expected_eur: 50,
    };

    const report = generateClosingReport(
      closingData,
      mockDailyStats,
      90000,
      FIXED_NOW,
    );

    expect(report).toContain("Variance (USD): -100.00 USD (-10.00%) - Deficit");
    expect(report).toContain(
      "Variance (LBP): -100000.00 LBP (-6.67%) - Deficit",
    );
    expect(report).toContain("Variance (EUR): -5.00 EUR (-10.00%) - Deficit");
  });

  it("should generate a report with correct variances and percentages for a surplus", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "General Drawer",
      physical: {} as Record<string, number>,
      systemExpected: {} as Record<string, number>,
      physical_usd: 1100,
      physical_lbp: 1600000,
      physical_eur: 55,
      system_expected_usd: 1000,
      system_expected_lbp: 1500000,
      system_expected_eur: 50,
    };

    const report = generateClosingReport(
      closingData,
      mockDailyStats,
      90000,
      FIXED_NOW,
    );

    expect(report).toContain("Variance (USD): +100.00 USD (10.00%) - Surplus");
    expect(report).toContain(
      "Variance (LBP): +100000.00 LBP (6.67%) - Surplus",
    );
    expect(report).toContain("Variance (EUR): +5.00 EUR (10.00%) - Surplus");
  });

  it("should handle zero system expected values for percentage calculation", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "General Drawer",
      physical: {} as Record<string, number>,
      systemExpected: {} as Record<string, number>,
      physical_usd: 100,
      physical_lbp: 100,
      physical_eur: 100,
      system_expected_usd: 0,
      system_expected_lbp: 0,
      system_expected_eur: 0,
    };

    const report = generateClosingReport(
      closingData,
      mockDailyStats,
      90000,
      FIXED_NOW,
    );

    // When system_expected is 0, percentage should ideally be N/A or 0%.
    // The current implementation calculates (variance / 0) * 100 which results in Infinity,
    // leading to 'Infinity%' in the report. I should update the formatVariance function to handle this case.
    expect(report).toContain("Variance (USD): +100.00 USD (0.00%) - Surplus");
    expect(report).toContain("Variance (LBP): +100.00 LBP (0.00%) - Surplus");
    expect(report).toContain("Variance (EUR): +100.00 EUR (0.00%) - Surplus");
  });

  it("defaults `now` to the current time when the caller does not inject a clock", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "General Drawer",
      physical: {} as Record<string, number>,
      systemExpected: {} as Record<string, number>,
    };
    // No 4th arg — must not throw, and must print SOME "as of HH:MM" line
    // (existing callers like Checkpoint/index.tsx that predate LIRA-219's
    // clock injection keep compiling and working unchanged).
    const report = generateClosingReport(closingData, mockDailyStats, 90000);
    expect(report).toMatch(/Profit as of \d{2}:\d{2}/);
  });

  describe("profit access/failure gating (LIRA-219 E-Q6/E-Q7)", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "General Drawer",
      physical: {} as Record<string, number>,
      systemExpected: {} as Record<string, number>,
    };

    it("prints the hidden label and no numbers when profitHidden is set, never a fabricated figure", () => {
      const hiddenStats: DailyStatsSnapshot = {
        salesCount: 5,
        totalSalesUSD: 100,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 10,
        totalExpensesLBP: 0,
        profitDay: "2023-12-16",
        profitHidden: true,
      };

      const report = generateClosingReport(
        closingData,
        hiddenStats,
        90000,
        FIXED_NOW,
      );

      expect(report).toContain(PROFIT_HIDDEN_LABEL);
      expect(report).not.toContain(GROSS_PROFIT_USD_LABEL);
      expect(report).not.toContain(NET_PROFIT_USD_LABEL);
      expect(report).not.toContain("$0.00");
      // Activity stats still print — only profit is withheld.
      expect(report).toContain("Sales Count: 5");
    });

    it("prints 'unavailable' and no numbers when profitUnavailable is set, never a fabricated $0.00", () => {
      const unavailableStats: DailyStatsSnapshot = {
        salesCount: 5,
        totalSalesUSD: 100,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 10,
        totalExpensesLBP: 0,
        profitDay: "2023-12-16",
        profitUnavailable: true,
      };

      const report = generateClosingReport(
        closingData,
        unavailableStats,
        90000,
        FIXED_NOW,
      );

      expect(report).toContain(PROFIT_UNAVAILABLE_LABEL);
      expect(report).not.toContain(GROSS_PROFIT_USD_LABEL);
      expect(report).not.toContain(NET_PROFIT_USD_LABEL);
      expect(report).not.toContain("$0.00");
      expect(report).toContain("Sales Count: 5");
    });

    it("falls back to the unavailable label (never a fabricated $0.00) if neither flag is set but the profit figure is still absent", () => {
      // Defensive: ClosingService always sets profitHidden when includeProfit
      // is false, so this combination should not occur in practice — but a
      // money-report renderer must never silently print $0.00 for a missing
      // figure regardless of how it got here (C.6).
      const noFlagsStats: DailyStatsSnapshot = {
        salesCount: 5,
        totalSalesUSD: 100,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 10,
        totalExpensesLBP: 0,
        profitDay: "2023-12-16",
      };

      const report = generateClosingReport(
        closingData,
        noFlagsStats,
        90000,
        FIXED_NOW,
      );

      expect(report).toContain(PROFIT_UNAVAILABLE_LABEL);
      expect(report).not.toContain("$0.00");
    });
  });
});

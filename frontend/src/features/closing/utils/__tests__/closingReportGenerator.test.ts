// src/utils/__tests__/closingReportGenerator.test.ts
import { generateClosingReport } from "../closingReportGenerator";

const mockDailyStats = {
  salesCount: 10,
  totalSalesUSD: 1000,
  totalSalesLBP: 1500000,
  debtPaymentsUSD: 100,
  debtPaymentsLBP: 150000,
  totalExpensesUSD: 50,
  totalExpensesLBP: 75000,
  totalProfitUSD: 300,
};

describe("generateClosingReport", () => {
  it("should generate a report with correct variances and percentages for a perfect match", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "General Drawer",
      physical_usd: 1000,
      physical_lbp: 1500000,
      physical_eur: 50,
      system_expected_usd: 1000,
      system_expected_lbp: 1500000,
      system_expected_eur: 50,
    };

    const report = generateClosingReport(closingData, mockDailyStats);

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
    expect(report).toContain("Total Profit (USD): 300.00");
  });

  it("should generate a report with correct variances and percentages for a deficit", () => {
    const closingData = {
      closing_date: "2023-12-16",
      drawer_name: "OMT Drawer",
      physical_usd: 900,
      physical_lbp: 1400000,
      physical_eur: 45,
      system_expected_usd: 1000,
      system_expected_lbp: 1500000,
      system_expected_eur: 50,
    };

    const report = generateClosingReport(closingData, mockDailyStats);

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
      physical_usd: 1100,
      physical_lbp: 1600000,
      physical_eur: 55,
      system_expected_usd: 1000,
      system_expected_lbp: 1500000,
      system_expected_eur: 50,
    };

    const report = generateClosingReport(closingData, mockDailyStats);

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
      physical_usd: 100,
      physical_lbp: 100,
      physical_eur: 100,
      system_expected_usd: 0,
      system_expected_lbp: 0,
      system_expected_eur: 0,
    };

    const report = generateClosingReport(closingData, mockDailyStats);

    // When system_expected is 0, percentage should ideally be N/A or 0%.
    // The current implementation calculates (variance / 0) * 100 which results in Infinity,
    // leading to 'Infinity%' in the report. I should update the formatVariance function to handle this case.
    expect(report).toContain("Variance (USD): +100.00 USD (0.00%) - Surplus");
    expect(report).toContain("Variance (LBP): +100.00 LBP (0.00%) - Surplus");
    expect(report).toContain("Variance (EUR): +100.00 EUR (0.00%) - Surplus");
  });
});

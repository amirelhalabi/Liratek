type ClosingReportData = {
  closing_date: string;
  drawer_name: string;
  /** Physical count per currency: { USD: 123, LBP: 456000, EUR: 50 } */
  physical: Record<string, number>;
  /** System expected per currency: { USD: 120, LBP: 460000, EUR: 50 } */
  systemExpected: Record<string, number>;
  // Legacy fields (backward compat)
  physical_usd?: number;
  system_expected_usd?: number;
  physical_lbp?: number;
  system_expected_lbp?: number;
  physical_eur?: number;
  system_expected_eur?: number;
};

type DailyStatsData = {
  salesCount: number;
  totalSalesUSD: number;
  totalSalesLBP: number;
  debtPaymentsUSD: number;
  debtPaymentsLBP: number;
  totalExpensesUSD: number;
  totalExpensesLBP: number;
  totalProfitUSD: number;
};

export function generateClosingReport(
  closingData: ClosingReportData,
  dailyStats: DailyStatsData,
): string {
  // Build per-currency data from dynamic fields or legacy fields
  const physical: Record<string, number> = closingData.physical ?? {};
  const systemExpected: Record<string, number> =
    closingData.systemExpected ?? {};

  // Merge legacy fields if present (backward compat)
  if (closingData.physical_usd != null)
    physical["USD"] = closingData.physical_usd;
  if (closingData.system_expected_usd != null)
    systemExpected["USD"] = closingData.system_expected_usd;
  if (closingData.physical_lbp != null)
    physical["LBP"] = closingData.physical_lbp;
  if (closingData.system_expected_lbp != null)
    systemExpected["LBP"] = closingData.system_expected_lbp;
  if (closingData.physical_eur != null)
    physical["EUR"] = closingData.physical_eur;
  if (closingData.system_expected_eur != null)
    systemExpected["EUR"] = closingData.system_expected_eur;

  // Get all currencies present in either physical or expected
  const allCurrencies = [
    ...new Set([...Object.keys(physical), ...Object.keys(systemExpected)]),
  ].sort();

  const formatVariance = (
    variance: number,
    expected: number,
    currency: string,
  ) => {
    if (variance === 0) return `0.00 ${currency} (0.00%) - Perfect Match`;

    let percentage = 0;
    let varianceSign = "";
    let status = "";

    if (expected !== 0) {
      percentage = (Math.abs(variance) / expected) * 100;
    }

    if (variance > 0) {
      varianceSign = "+";
      status = "Surplus";
    } else {
      varianceSign = "-";
      status = "Deficit";
    }

    return `${varianceSign}${Math.abs(variance).toFixed(2)} ${currency} (${variance < 0 ? "-" : ""}${percentage.toFixed(2)}%) - ${status}`;
  };

  const formatAmount = (amount: number, currency: string) => {
    if (currency === "LBP") return amount.toLocaleString();
    return amount.toFixed(2);
  };

  // Build per-currency summary lines
  const currencySummary = allCurrencies
    .map((currency) => {
      const phys = physical[currency] ?? 0;
      const expected = systemExpected[currency] ?? 0;
      const variance = phys - expected;
      return `  Physical Count (${currency}): ${formatAmount(phys, currency)}
  System Expected (${currency}): ${formatAmount(expected, currency)}
  Variance (${currency}): ${formatVariance(variance, expected, currency)}`;
    })
    .join("\n\n");

  const reportContent = `
--- Daily Closing Report ---
Date: ${closingData.closing_date}
Drawer: ${closingData.drawer_name}

Summary:
${currencySummary}

--- Daily Statistics Snapshot ---
  Sales Count: ${dailyStats.salesCount}
  Total Sales (USD): ${dailyStats.totalSalesUSD.toFixed(2)}
  Total Sales (LBP): ${dailyStats.totalSalesLBP.toLocaleString()}
  Debt Payments (USD): ${dailyStats.debtPaymentsUSD.toFixed(2)}
  Debt Payments (LBP): ${dailyStats.debtPaymentsLBP.toLocaleString()}
  Total Expenses (USD): ${dailyStats.totalExpensesUSD.toFixed(2)}
  Total Expenses (LBP): ${dailyStats.totalExpensesLBP.toLocaleString()}
  Total Profit (USD): ${dailyStats.totalProfitUSD.toFixed(2)}
`;

  return reportContent;
}

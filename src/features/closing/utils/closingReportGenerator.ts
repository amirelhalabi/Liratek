export function generateClosingReport(
  closingData: any,
  dailyStats: any,
): string {
  const usdVariance =
    closingData.physical_usd - closingData.system_expected_usd;
  const lbpVariance =
    closingData.physical_lbp - closingData.system_expected_lbp;
  const eurVariance =
    closingData.physical_eur - (closingData.system_expected_eur || 0); // Ensure EUR variance is calculated correctly

  const formatVariance = (
    variance: number,
    systemExpected: number,
    currency: string,
  ) => {
    if (variance === 0) return `0.00 ${currency} (0.00%) - Perfect Match`;

    let percentage = 0;
    let varianceSign = ""; // Sign for the variance amount
    let status = "";

    if (systemExpected !== 0) {
      percentage = (Math.abs(variance) / systemExpected) * 100; // Calculate absolute percentage
    } else if (variance !== 0) {
      percentage = 0; // If expected is zero and variance exists, percentage is 0%
    }

    if (variance > 0) {
      varianceSign = "+";
      status = "Surplus";
    } else if (variance < 0) {
      varianceSign = "-";
      status = "Deficit";
    } else {
      // variance === 0, already handled above
      return `0.00 ${currency} (0.00%) - Perfect Match`;
    }

    return `${varianceSign}${Math.abs(variance).toFixed(2)} ${currency} (${variance < 0 ? "-" : ""}${percentage.toFixed(2)}%) - ${status}`;
  };

  let reportContent = `
--- Daily Closing Report ---
Date: ${closingData.closing_date}
Drawer: ${closingData.drawer_name}

Summary:
  Physical Count (USD): ${closingData.physical_usd.toFixed(2)}
  System Expected (USD): ${closingData.system_expected_usd.toFixed(2)}
  Variance (USD): ${formatVariance(usdVariance, closingData.system_expected_usd, "USD")}

  Physical Count (LBP): ${closingData.physical_lbp.toLocaleString()}
  System Expected (LBP): ${closingData.system_expected_lbp.toLocaleString()}
  Variance (LBP): ${formatVariance(lbpVariance, closingData.system_expected_lbp, "LBP")}
  
  Physical Count (EUR): ${closingData.physical_eur.toFixed(2)}
  System Expected (EUR): ${(closingData.system_expected_eur || 0).toFixed(2)}
  Variance (EUR): ${formatVariance(eurVariance, closingData.system_expected_eur || 0, "EUR")}

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

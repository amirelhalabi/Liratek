import type { DailyStatsSnapshot } from "@liratek/core";
import {
  buildRateStampedProfitLines,
  formatRateStampedProfitBlock,
  buildNetProfitLines,
  formatNetProfitBlock,
  formatProfitAsOfLine,
  PROFIT_HIDDEN_LABEL,
  PROFIT_UNAVAILABLE_LABEL,
} from "./rateStampedProfit";

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

/**
 * LIRA-219 — the profit block. `dailyStats` is now typed as the ONE
 * `DailyStatsSnapshot` from `@liratek/core` (rule 21: derived from the
 * pinned contract, never a hand-copied local type). Exactly one of "the two
 * profit fields present", `profitHidden`, or `profitUnavailable` describes
 * any given snapshot (C.6/E-Q6/E-Q7) — this function renders each case
 * distinctly and never lets an absent figure read as a silent $0.00.
 */
function buildProfitSection(
  dailyStats: DailyStatsSnapshot,
  sellRate: number,
  now: Date,
): string {
  if (dailyStats.profitHidden) {
    return `  ${PROFIT_HIDDEN_LABEL}`;
  }

  // Defensive fallback (C.6): a snapshot with neither flag set but no
  // profit figure either must still never print a fabricated $0.00.
  // ClosingService always sets `profitHidden` when profit was not
  // requested/gated out, so this arm is a belt-and-braces guard, not the
  // expected path.
  if (dailyStats.profitUnavailable || dailyStats.totalProfitUSD === undefined) {
    return `  ${PROFIT_UNAVAILABLE_LABEL}`;
  }

  const grossUsd = dailyStats.totalProfitUSD;
  const grossLbp = dailyStats.totalProfitLBP ?? 0;

  // LIRA-174: single rate-stamped USD+LBP GROSS profit view (E-Q5: the
  // converted "Total (USD/LBP) @ rate" lines stay gross, per the owner's
  // explicit PDF-specific spec).
  const grossLines = buildRateStampedProfitLines(grossUsd, grossLbp, sellRate);
  const grossBlock = formatRateStampedProfitBlock(grossLines);

  // LIRA-219 E-Q1: Net profit = gross − expenses, per currency, no rate —
  // matches the Profits headline card, no combined/converted total.
  const netLines = buildNetProfitLines(
    grossUsd,
    grossLbp,
    dailyStats.totalExpensesUSD,
    dailyStats.totalExpensesLBP,
  );
  const netBlock = formatNetProfitBlock(netLines);

  // LIRA-219 E-Q3: point-in-time footnote, from the injected clock.
  const asOfLine = formatProfitAsOfLine(now);

  return [grossBlock, netBlock, asOfLine].join("\n");
}

export function generateClosingReport(
  closingData: ClosingReportData,
  dailyStats: DailyStatsSnapshot,
  /** LIRA-174: today's sell_rate (`useSellRate().sellRate` at the call
   *  site) — injected by the caller, never read from inside this module or
   *  hardcoded here. See `rateStampedProfit.ts` for why sell (not the
   *  app-wide buy convention) is used for this document. */
  sellRate: number,
  /** LIRA-219 E-Q3 (SOLID/DIP) — the device's own clock at print time,
   *  injected by the caller (`Checkpoint/index.tsx` passes `new Date()`),
   *  never read from inside this module. Defaults to `new Date()` so any
   *  existing caller that predates this parameter keeps compiling and
   *  printing a correct (if unpinned) "as of" line unchanged; tests inject
   *  a fixed `Date` for determinism. */
  now: Date = new Date(),
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

  // LIRA-219: gross + net profit block, or the hidden/unavailable label —
  // see buildProfitSection above for what each branch renders and why.
  const profitBlock = buildProfitSection(dailyStats, sellRate, now);

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

${profitBlock}
`;

  return reportContent;
}

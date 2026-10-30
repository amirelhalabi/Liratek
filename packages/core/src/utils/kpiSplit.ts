/**
 * LIRA-364 — split counterparty balances into the two "owes" sides of a
 * monthly KPI. Each currency is judged on its own: a customer who owes $50 and
 * holds a 450,000 LBP credit counts on both sides. Pure, browser-safe
 * (rule 29).
 */

export interface CurrencyAmounts {
  usd: number;
  lbp: number;
}

/** Below these a balance is dust and counts as zero. */
const USD_EPS = 0.005;
const LBP_EPS = 0.5;

/**
 * `positive` sums the positive balances; `negative` sums the negative ones as
 * absolute values. The caller decides which side means "the shop owes".
 */
export function splitBySign(rows: readonly CurrencyAmounts[]): {
  positive: CurrencyAmounts;
  negative: CurrencyAmounts;
} {
  const positive = { usd: 0, lbp: 0 };
  const negative = { usd: 0, lbp: 0 };
  for (const row of rows) {
    if (row.usd >= USD_EPS) positive.usd += row.usd;
    else if (row.usd <= -USD_EPS) negative.usd -= row.usd;
    if (row.lbp >= LBP_EPS) positive.lbp += row.lbp;
    else if (row.lbp <= -LBP_EPS) negative.lbp -= row.lbp;
  }
  return {
    positive: { usd: roundUsd(positive.usd), lbp: Math.round(positive.lbp) },
    negative: { usd: roundUsd(negative.usd), lbp: Math.round(negative.lbp) },
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

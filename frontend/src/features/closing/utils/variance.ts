/**
 * Variance status helpers for the checkpoint flow.
 *
 * A drawer field is compared against its system-expected balance and bucketed
 * into a three-tier status used to colour the UI:
 *   - "match"  → physical equals expected (within rounding)        → green
 *   - "within" → differs but inside the configured tolerance       → amber
 *   - "beyond" → differs beyond the configured tolerance           → red
 */

export type VarianceStatus = "match" | "within" | "beyond";

export interface VarianceInfo {
  status: VarianceStatus;
  /** physical − expected */
  variance: number;
  /** Absolute variance as a percentage of expected (Infinity when expected is 0). */
  pct: number;
}

/** Sub-unit threshold below which a difference is treated as an exact match. */
const MATCH_EPSILON = 0.01;

export function getVarianceStatus(
  physical: number,
  expected: number,
  thresholdPct: number,
): VarianceInfo {
  const variance = physical - expected;
  if (Math.abs(variance) <= MATCH_EPSILON) {
    return { status: "match", variance: 0, pct: 0 };
  }
  const pct =
    expected !== 0 ? (Math.abs(variance) / Math.abs(expected)) * 100 : Infinity;
  // A threshold of 0 (disabled) means no tolerance — any difference is "beyond".
  if (thresholdPct > 0 && pct <= thresholdPct) {
    return { status: "within", variance, pct };
  }
  return { status: "beyond", variance, pct };
}

/** Format an amount for display: LBP as whole numbers, others with 2 decimals. */
export function formatCurrencyAmount(amount: number, code: string): string {
  if (code === "LBP") return Math.round(amount).toLocaleString();
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

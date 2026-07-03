/**
 * Variance status helpers for the checkpoint flow.
 *
 * A drawer field is compared against its expected balance and bucketed into a
 * two-tier status used to colour the UI. There is NO tolerance — any difference
 * beyond a sub-unit rounding epsilon is flagged for attention:
 *   - "match" → physical equals expected (within rounding)  → green
 *   - "diff"  → any difference exists                        → amber (attention)
 */

export type VarianceStatus = "match" | "diff";

export interface VarianceInfo {
  status: VarianceStatus;
  /** physical − expected */
  variance: number;
}

/** Sub-unit threshold below which a difference is treated as an exact match. */
const MATCH_EPSILON = 0.01;

export function getVarianceStatus(
  physical: number,
  expected: number,
): VarianceInfo {
  const variance = physical - expected;
  if (Math.abs(variance) <= MATCH_EPSILON) {
    return { status: "match", variance: 0 };
  }
  return { status: "diff", variance };
}

/** Format an amount for display: LBP as whole numbers, others with 2 decimals. */
export function formatCurrencyAmount(amount: number, code: string): string {
  if (code === "LBP") return Math.round(amount).toLocaleString();
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

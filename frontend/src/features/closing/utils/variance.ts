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

// ---------------------------------------------------------------------------
// Validity-date variance (carrier lines — checkpoint Phase 3)
// ---------------------------------------------------------------------------

export interface DateVarianceInfo {
  status: VarianceStatus;
  /** counted − expected, in whole calendar days. 0 on a match. */
  days: number;
}

/**
 * The ONE definition of "did the counted SIM expiry differ from the stored
 * one" (rule 14) — used by both the checkpoint card and the timeline, so the
 * two surfaces can never disagree about what counts as a variance.
 *
 * Both dates are plain `YYYY-MM-DD` calendar strings, so the difference is
 * computed in UTC (a fixed 86,400,000 ms/day, no DST to distort it). A
 * missing counted date means validity was not counted — that is a match, not
 * a variance; a counted date against a line that had none is a variance with
 * no measurable day count (0 days, still flagged).
 */
export function getDateVarianceStatus(
  counted: string | null | undefined,
  expected: string | null | undefined,
): DateVarianceInfo {
  if (!counted) return { status: "match", days: 0 };
  if (counted === expected) return { status: "match", days: 0 };
  if (!expected) return { status: "diff", days: 0 };
  const [cy, cm, cd] = counted.split("-").map(Number);
  const [ey, em, ed] = expected.split("-").map(Number);
  const days = Math.round(
    (Date.UTC(cy, cm - 1, cd) - Date.UTC(ey, em - 1, ed)) / 86_400_000,
  );
  return { status: "diff", days };
}

/** Signed day count for display, e.g. `+15d` / `-3d`; `—` when unmeasurable. */
export function formatDayVariance(days: number): string {
  if (days === 0) return "—";
  return `${days > 0 ? "+" : ""}${days}d`;
}

/** Format an amount for display: LBP as whole numbers, others with 2 decimals. */
export function formatCurrencyAmount(amount: number, code: string): string {
  if (code === "LBP") return Math.round(amount).toLocaleString();
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

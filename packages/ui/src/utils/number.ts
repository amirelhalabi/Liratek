/**
 * Decimal-input formatting & parsing helpers.
 *
 * Single source of truth for the thousands-separator amount fields across the
 * app — consumed by the `DecimalInput` component. The pattern: keep the raw
 * typed string as state, render it through `formatWithCommas`, and sanitize
 * keystrokes with `sanitizeDecimal`.
 */

export interface DecimalConstraints {
  /** Allow a leading minus sign. Default false. */
  allowNegative?: boolean;
  /** Max number of fraction digits. Omit for unlimited. */
  decimals?: number;
}

/**
 * Format a numeric string with thousand-separator commas, preserving an
 * in-progress decimal tail and an optional leading minus.
 *   "1234.5"  -> "1,234.5"
 *   "0."      -> "0."
 *   "-1000"   -> "-1,000"
 */
export function formatWithCommas(value: string): string {
  if (!value) return value;
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const parts = body.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + parts.join(".");
}

/**
 * True when `value` is a valid in-progress decimal entry — "", "-", "4", "4.",
 * "4.50" — under the given constraints. Retained for callers that validate a
 * candidate string themselves; `DecimalInput` uses `sanitizeDecimal` instead.
 */
export function isPartialDecimal(
  value: string,
  { allowNegative = false, decimals }: DecimalConstraints = {},
): boolean {
  const sign = allowNegative ? "-?" : "";
  const frac = decimals === undefined ? "[0-9]*" : `[0-9]{0,${decimals}}`;
  return new RegExp(`^${sign}[0-9]*\\.?${frac}$`).test(value);
}

/**
 * Coerce any user-typed string into a valid (comma-free) decimal string,
 * honouring the constraints: strips commas/letters, keeps at most one decimal
 * point, an optional single leading minus, and caps fraction digits. Never
 * rejects — always returns something renderable, which is what lets the input
 * accept "0.", "0.10", "-" mid-edit without ever snapping back.
 */
export function sanitizeDecimal(
  input: string,
  { allowNegative = false, decimals }: DecimalConstraints = {},
): string {
  let s = input.replace(/,/g, "");
  const negative = allowNegative && s.trimStart().startsWith("-");
  s = s.replace(/[^0-9.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    // Keep the first dot, drop any subsequent ones.
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    if (decimals !== undefined) {
      const [intPart, fracPart = ""] = s.split(".");
      s = `${intPart}.${fracPart.slice(0, decimals)}`;
    }
  }
  return (negative ? "-" : "") + s;
}

/** Parse a raw (comma-free) decimal string to a number; "" / "-" / "." → 0. */
export function parseDecimal(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Given a comma-formatted string and a desired number of significant (non-comma)
 * characters to the left of the caret, return the caret index in the formatted
 * string. Used to keep the caret stable while commas are inserted/removed live.
 */
export function caretAfterFormat(
  formatted: string,
  significantLeft: number,
): number {
  let count = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (count >= significantLeft) return i;
    if (formatted[i] !== ",") count++;
  }
  return formatted.length;
}

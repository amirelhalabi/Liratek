/**
 * Thousand-separator helpers for amount text inputs.
 *
 * Pattern (same as the checkpoint DrawerCard): keep the raw numeric string in
 * state, render it through `formatWithCommas`, and strip commas on change
 * before validating with `isPartialDecimal`.
 */

/** Format a numeric string with thousand-separator commas, preserving decimals */
export function formatWithCommas(value: string): string {
  if (!value) return value;
  const parts = value.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

/** True when the string is a valid in-progress non-negative decimal entry (e.g. "", "4", "4.", "4.50") */
export function isPartialDecimal(value: string): boolean {
  return /^[0-9]*\.?[0-9]*$/.test(value);
}

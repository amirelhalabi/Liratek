/**
 * LIRA-329 — free text for a transaction's details: kept in full, or omitted
 * when empty. The details schema refuses "" (`min(1)`), so a builder must
 * never forward a blank value as if the cashier had typed something.
 *
 * Pure leaf (browser-safe, rule 29).
 */
export function nonBlankText(v: string | null | undefined): string | undefined {
  return v != null && v.trim() !== "" ? v : undefined;
}

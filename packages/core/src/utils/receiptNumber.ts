/**
 * LIRA-296 — the ONE receipt number a sale carries, defined once (rule 14).
 *
 * Before this, checkout printed `RCP-${Date.now()}` and a reprint
 * `RCP-${sale.id}`: two numbers for one sale, and neither searchable. The
 * receipt number is now the sale id with an `RCP-` prefix — unique per
 * database, short, and needing no stored counter.
 *
 * Pure and browser-safe (rule 29): exported from BOTH `index.ts` and
 * `browser.ts`.
 */

export const RECEIPT_NUMBER_PREFIX = "RCP-";

/** `RCP-<saleId>` — what checkout, reprints and the warranty search show. */
export function receiptNumberFor(saleId: number): string {
  return `${RECEIPT_NUMBER_PREFIX}${saleId}`;
}

/**
 * The sale id a cashier typed, or `null` when the input is not a receipt
 * number. Accepts `RCP-12`, `rcp12`, `rcp-12` and a bare `12` (case and
 * surrounding spaces ignored); anything else — including `0`, decimals and
 * signs — is `null`, so a free-text search never mistakes a name for an id.
 */
export function parseReceiptNumber(input: string): number | null {
  const match = /^(?:rcp-?)?([1-9][0-9]{0,15})$/i.exec(input.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

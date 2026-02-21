/**
 * Currency Utilities (Frontend)
 *
 * Static fallback for use outside of React context
 * (e.g., receiptFormatter.ts, closingReportGenerator.ts).
 *
 * When inside a React component, prefer useCurrencyContext() instead
 * for DB-sourced data.
 */

const SYMBOL_MAP: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  LBP: "LBP",
  USDT: "USDT",
  AED: "AED",
};

const DECIMALS_MAP: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  LBP: 0,
  USDT: 2,
  AED: 2,
};

/**
 * Get the display symbol for a currency code.
 * Falls back to the code itself if not in the static map.
 */
export function getCurrencySymbol(code: string): string {
  return SYMBOL_MAP[code] || code;
}

/**
 * Get the number of decimal places for a currency code.
 * Defaults to 2.
 */
export function getCurrencyDecimals(code: string): number {
  return DECIMALS_MAP[code] ?? 2;
}

/**
 * Format a numeric amount with the correct currency symbol and decimal places.
 */
export function formatCurrency(amount: number, code: string): string {
  const sym = getCurrencySymbol(code);
  const dec = getCurrencyDecimals(code);
  const formatted = amount.toFixed(dec);
  // Prefix-style for $, €, £; suffix-style for everything else
  if (["$", "€", "£"].includes(sym)) return `${sym}${formatted}`;
  return `${formatted} ${sym}`;
}

/**
 * Currency Utility Functions
 *
 * Shared utilities for currency-related calculations and display.
 * Schema (v59): (to_code, market_rate, buy_rate, sell_rate, is_stronger)
 */

export interface ExchangeRate {
  id?: number;
  to_code: string;
  market_rate: number;
  buy_rate: number;
  sell_rate: number;
  is_stronger: 1 | -1;
  updated_at?: string;
}

/**
 * Calculate profit spread for a currency (sell - buy).
 *
 * @param rates - Array of exchange rates from database
 * @param currencyCode - Non-USD currency code (e.g. 'LBP', 'EUR')
 * @returns Spread (sell - buy) or null if rate not found
 */
export function calculateProfitSpread(
  rates: ExchangeRate[],
  currencyCode: string,
): number | null {
  if (!rates || rates.length === 0) return null;
  if (!currencyCode || currencyCode === "USD") return null;

  const row = rates.find((r) => r.to_code === currencyCode);
  if (!row) return null;

  return row.sell_rate - row.buy_rate;
}

/**
 * Get effective buy rate for a currency (we give — favorable to us).
 */
export function getBuyRate(rate: ExchangeRate): number {
  return rate.buy_rate;
}

/**
 * Get effective sell rate for a currency (customer gives — favorable to us).
 */
export function getSellRate(rate: ExchangeRate): number {
  return rate.sell_rate;
}

/**
 * Format currency amount for display
 *
 * @param amount - Amount to format
 * @param currency - Currency code
 * @param decimals - Number of decimal places (optional, auto-detected)
 * @returns Formatted string
 *
 * @example
 * formatCurrencyAmount(89500, 'LBP'); // "89,500"
 * formatCurrencyAmount(1.16, 'USD');  // "1.16"
 */
export function formatCurrencyAmount(
  amount: number,
  currency: string,
  decimals?: number,
): string {
  const places = decimals ?? (currency === "LBP" ? 0 : 2);
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

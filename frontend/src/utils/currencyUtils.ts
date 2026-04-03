/**
 * Currency Utility Functions
 *
 * Shared utilities for currency-related calculations and display.
 * Uses new v30 schema: (to_code, market_rate, delta, is_stronger)
 */

export interface ExchangeRate {
  id?: number;
  to_code: string;
  market_rate: number;
  delta: number;
  is_stronger: 1 | -1;
  updated_at?: string;
}

/**
 * Calculate profit spread for a currency (2 × delta in native units).
 *
 * New schema: spread = 2 × delta (the full buy/sell range).
 *
 * @param rates - Array of exchange rates from database (new 4-column schema)
 * @param currencyCode - Non-USD currency code (e.g. 'LBP', 'EUR')
 * @returns Spread (2×delta) or null if rate not found
 *
 * @example
 * calculateProfitSpread(rates, 'LBP');  // Returns 1000 (2 × 500 LBP)
 * calculateProfitSpread(rates, 'EUR');  // Returns 0.04 (2 × 0.02 USD)
 */
export function calculateProfitSpread(
  rates: ExchangeRate[],
  currencyCode: string,
): number | null {
  if (!rates || rates.length === 0) return null;
  if (!currencyCode || currencyCode === "USD") return null;

  const row = rates.find((r) => r.to_code === currencyCode);
  if (!row) return null;

  return row.delta * 2;
}

/**
 * Get effective buy rate for a currency (we pay customer — favorable to us, lower value).
 * buyRate = min(market + delta, market - delta)
 */
export function getBuyRate(rate: ExchangeRate): number {
  return Math.min(rate.market_rate + rate.delta, rate.market_rate - rate.delta);
}

/**
 * Get effective sell rate for a currency (customer pays us — favorable to us, higher value).
 * sellRate = max(market + delta, market - delta)
 */
export function getSellRate(rate: ExchangeRate): number {
  return Math.max(rate.market_rate + rate.delta, rate.market_rate - rate.delta);
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

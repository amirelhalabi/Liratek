/**
 * Currency Constants and Configuration
 *
 * Centralized configuration for all currency-related values.
 * Update these when market rates change.
 */

/**
 * Supported currency codes
 */
export const CURRENCY_CODES = {
  USD: "USD",
  LBP: "LBP",
  EUR: "EUR",
} as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[keyof typeof CURRENCY_CODES];

/**
 * Base (market) exchange rates
 *
 * These represent the real market value and are used for profit calculation.
 *
 * Format (Option B - Stronger Currency as Base):
 * - LBP (weaker than USD): "1 USD = X LBP"
 * - EUR (stronger than USD): "1 EUR = X USD"
 */
export const BASE_EXCHANGE_RATES = {
  /** 1 USD = 89,000 LBP (market value) */
  LBP_PER_USD: 89000,

  /** 1 EUR = 1.18 USD (market value) */
  USD_PER_EUR: 1.18,
} as const;

/**
 * Transaction exchange rates (BUY/SELL spread)
 *
 * BUY = We buy FROM currency from customer (lower rate)
 * SELL = We sell FROM currency to customer (higher rate)
 */
export const TRANSACTION_RATES = {
  /** We buy USD from customer (give 88,500 LBP per USD) */
  LBP_BUY_USD: 88500,

  /** We sell USD to customer (receive 89,500 LBP per USD) */
  LBP_SELL_USD: 89500,

  /** We buy EUR from customer (pay 1.16 USD per EUR) */
  EUR_BUY_USD: 1.16,

  /** We sell EUR to customer (charge 1.20 USD per EUR) */
  EUR_SELL_USD: 1.2,
} as const;

/**
 * Currency display configuration
 */
export const CURRENCY_CONFIG = {
  [CURRENCY_CODES.USD]: {
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    decimals: 2,
    isBase: true,
  },
  [CURRENCY_CODES.LBP]: {
    code: "LBP",
    name: "Lebanese Pound",
    symbol: "LBP",
    decimals: 0,
    isBase: false,
  },
  [CURRENCY_CODES.EUR]: {
    code: "EUR",
    name: "Euro",
    symbol: "€",
    decimals: 2,
    isBase: false,
  },
} as const;

/**
 * Helper to get base rate for a currency pair
 *
 * @param fromCurrency - Source currency
 * @param toCurrency - Target currency
 * @returns Base market rate or null if not configured
 */
export function getBaseRate(
  fromCurrency: string,
  toCurrency: string,
): number | null {
  // USD ↔ LBP
  if (fromCurrency === "USD" || toCurrency === "USD") {
    if (fromCurrency === "LBP" || toCurrency === "LBP") {
      return BASE_EXCHANGE_RATES.LBP_PER_USD;
    }
  }

  // USD ↔ EUR (stored as USD per EUR)
  if (
    (fromCurrency === "EUR" && toCurrency === "USD") ||
    (fromCurrency === "USD" && toCurrency === "EUR")
  ) {
    return BASE_EXCHANGE_RATES.USD_PER_EUR;
  }

  return null;
}

/**
 * Helper to convert any amount to USD for consistent profit tracking
 *
 * @param amount - Amount in source currency
 * @param currency - Source currency code
 * @returns Equivalent amount in USD
 */
export function convertToUsd(amount: number, currency: string): number {
  switch (currency) {
    case CURRENCY_CODES.USD:
      return amount;
    case CURRENCY_CODES.LBP:
      return amount / BASE_EXCHANGE_RATES.LBP_PER_USD;
    case CURRENCY_CODES.EUR:
      return amount * BASE_EXCHANGE_RATES.USD_PER_EUR;
    default:
      return amount;
  }
}

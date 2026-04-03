/**
 * Exchange Rate Calculator
 *
 * Centralized utility for calculating exchange rates based on transaction type.
 * Ensures consistent rate selection across all modules.
 *
 * Business Rule:
 * - Money IN (Revenue): Use SELL rate (higher) - customer pays us more LBP
 * - Money OUT (Expense): Use BUY rate (lower) - we pay customer less LBP
 */

import {
  getExchangeRates,
  type TransactionType,
  type ExchangeRates,
} from "./exchangeRates";

export interface CalculateExchangeRateParams {
  /** Type of transaction */
  transactionType: TransactionType;

  /** Currency selected for payment (e.g., "LBP", "USD", "EUR") */
  selectedCurrency: string;

  /** Is money coming INTO the shop? (true = customer pays us, false = we pay customer) */
  isMoneyIn: boolean;

  /** Current exchange rates from database */
  rates: ExchangeRates;

  /** Fallback rate if rates not provided (default: 89,000) */
  fallbackRate?: number;
}

export interface CalculateExchangeRateResult {
  /** Calculated exchange rate */
  rate: number;

  /** Rate type (BUY or SELL) */
  rateType: "BUY" | "SELL" | "N/A";

  /** Human-readable description */
  description: string;
}

/**
 * Calculate exchange rate for a transaction
 *
 * @param params - Transaction parameters
 * @returns Exchange rate with metadata
 *
 * @example
 * // Customer pays $100 for IPEC transfer (Money IN)
 * const result = calculateExchangeRate({
 *   transactionType: "SERVICE_PAYMENT",
 *   selectedCurrency: "LBP",
 *   isMoneyIn: true,
 *   rates: { buyRate: 89000, sellRate: 89500 },
 * });
 * // Result: { rate: 89500, rateType: "SELL", description: "💰 SELL rate" }
 *
 * @example
 * // Customer refunds $100 IPEC transfer (Money OUT)
 * const result = calculateExchangeRate({
 *   transactionType: "REFUND",
 *   selectedCurrency: "LBP",
 *   isMoneyIn: false,
 *   rates: { buyRate: 89000, sellRate: 89500 },
 * });
 * // Result: { rate: 89000, rateType: "BUY", description: "💸 BUY rate" }
 */
export function calculateExchangeRate(
  params: CalculateExchangeRateParams,
): CalculateExchangeRateResult {
  const { selectedCurrency, isMoneyIn, rates, fallbackRate = 89000 } = params;

  // No conversion needed for base currency (USD)
  if (selectedCurrency === "USD") {
    return {
      rate: 1,
      rateType: "N/A",
      description: "Base currency (no conversion)",
    };
  }

  // Money IN (Revenue) → Use SELL rate (higher)
  // Money OUT (Expense) → Use BUY rate (lower)
  const rateType: "BUY" | "SELL" = isMoneyIn ? "SELL" : "BUY";
  const rate = rateType === "SELL" ? rates.sellRate : rates.buyRate;

  // Fallback if rate is invalid
  const finalRate = rate || fallbackRate;

  // Generate description
  const description = isMoneyIn
    ? "💰 SELL rate (Customer pays us)"
    : "💸 BUY rate (We pay customer)";

  return {
    rate: finalRate,
    rateType,
    description,
  };
}

/**
 * Determine if a transaction type is money IN (revenue) or money OUT (expense)
 *
 * @param transactionType - Type of transaction
 * @returns true if money is coming INTO the shop
 */
export function isMoneyInTransaction(
  transactionType: TransactionType,
): boolean {
  const moneyInTypes: TransactionType[] = [
    "SALE",
    "DEBT_PAYMENT",
    "SERVICE_PAYMENT",
    "CUSTOM_SERVICE",
    "EXCHANGE_BUY_USD", // Customer buys USD from us (we receive LBP)
  ];

  return moneyInTypes.includes(transactionType);
}

/**
 * Get exchange rates from API and calculate rate for transaction
 *
 * @param api - API client with getRates method
 * @param transactionType - Type of transaction
 * @param selectedCurrency - Selected currency
 * @param fallbackRate - Fallback rate if API fails
 * @returns Calculated exchange rate
 */
export async function fetchAndCalculateRate(
  api: { getRates: () => Promise<any[]> },
  transactionType: TransactionType,
  selectedCurrency: string,
  fallbackRate: number = 89000,
): Promise<number> {
  try {
    const rates = await api.getRates();
    const { buyRate, sellRate } = getExchangeRates(rates, fallbackRate);
    const isMoneyIn = isMoneyInTransaction(transactionType);

    const result = calculateExchangeRate({
      transactionType,
      selectedCurrency,
      isMoneyIn,
      rates: { buyRate, sellRate },
      fallbackRate,
    });

    return result.rate;
  } catch (error) {
    console.error("Failed to fetch exchange rates:", error);
    return fallbackRate;
  }
}

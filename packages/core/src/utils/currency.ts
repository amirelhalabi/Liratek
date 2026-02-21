/**
 * Currency Utility Module
 *
 * Provides synchronous in-memory cache, validation, and formatting helpers
 * for currency data loaded from the database via better-sqlite3, which is
 * synchronous by nature.
 */

import { getCurrencyRepository } from "../repositories/CurrencyRepository.js";
import type { CurrencyEntity } from "../repositories/CurrencyRepository.js";

// In-memory cache — refreshed when currencies change
let cachedCurrencies: CurrencyEntity[] | null = null;

/**
 * Get all active currency codes
 */
export function getActiveCurrencyCodes(): string[] {
  if (!cachedCurrencies) refreshCurrencyCache();
  return cachedCurrencies!.filter((c) => c.is_active).map((c) => c.code);
}

/**
 * Check if a currency code is valid (exists and is active)
 */
export function isValidCurrency(code: string): boolean {
  return getActiveCurrencyCodes().includes(code.toUpperCase());
}

/**
 * Get the display symbol for a currency code (e.g., "$", "€", "LBP")
 */
export function getCurrencySymbol(code: string): string {
  if (!cachedCurrencies) refreshCurrencyCache();
  const c = cachedCurrencies!.find((x) => x.code === code.toUpperCase());
  return c?.symbol || code;
}

/**
 * Get the number of decimal places for a currency code
 */
export function getCurrencyDecimals(code: string): number {
  if (!cachedCurrencies) refreshCurrencyCache();
  const c = cachedCurrencies!.find((x) => x.code === code.toUpperCase());
  return c?.decimal_places ?? 2;
}

/**
 * Format a numeric amount with the appropriate currency symbol and decimals
 */
export function formatCurrency(amount: number, code: string): string {
  const sym = getCurrencySymbol(code);
  const dec = getCurrencyDecimals(code);
  const formatted = amount.toFixed(dec);
  // Prefix-style for $, €, £; suffix-style for LBP, USDT, etc.
  if (["$", "€", "£"].includes(sym)) return `${sym}${formatted}`;
  return `${formatted} ${sym}`;
}

/**
 * Refresh the in-memory currency cache from the database
 */
export function refreshCurrencyCache(): void {
  try {
    const repo = getCurrencyRepository();
    cachedCurrencies = repo.findAllCurrencies();
  } catch {
    // If DB is not ready yet, initialize with empty array
    cachedCurrencies = [];
  }
}

/**
 * Clear the currency cache so the next read picks up changes
 */
export function clearCurrencyCache(): void {
  cachedCurrencies = null;
}

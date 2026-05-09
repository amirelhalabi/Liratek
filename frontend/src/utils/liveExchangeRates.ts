/**
 * Live Exchange Rate API
 *
 * Fetches real-time exchange rates from open.er-api.com (free, no API key).
 * Returns rates relative to USD base.
 *
 * Usage:
 *   const rates = await fetchLiveRates();
 *   // rates = { EUR: 0.85, GBP: 0.73, JPY: 157.08, ... }
 */

import type { CurrencyRate } from "@liratek/core";

const API_URL = "https://open.er-api.com/v6/latest/USD";

/** Currencies to exclude from the live API dropdown (managed locally) */
const EXCLUDED_CURRENCIES = new Set(["USD", "LBP", "EUR"]);

export interface LiveRateResponse {
  result: string;
  base_code: string;
  time_last_update_utc: string;
  rates: Record<string, number>;
}

/** Human-readable names for common API currencies */
export const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar",
  LBP: "Lebanese Pound",
  EUR: "Euro",
  GBP: "British Pound",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  CHF: "Swiss Franc",
  JPY: "Japanese Yen",
  AED: "UAE Dirham",
  SAR: "Saudi Riyal",
  TRY: "Turkish Lira",
  SEK: "Swedish Krona",
  NOK: "Norwegian Krone",
  DKK: "Danish Krone",
  CNY: "Chinese Yuan",
  INR: "Indian Rupee",
  BRL: "Brazilian Real",
  MXN: "Mexican Peso",
  KWD: "Kuwaiti Dinar",
  QAR: "Qatari Riyal",
  BHD: "Bahraini Dinar",
  OMR: "Omani Rial",
  JOD: "Jordanian Dinar",
  EGP: "Egyptian Pound",
  IQD: "Iraqi Dinar",
  SYP: "Syrian Pound",
};

/**
 * Fetch live exchange rates from the public API.
 * Returns raw rates object (1 USD = X units of each currency).
 */
export async function fetchLiveRates(): Promise<Record<string, number>> {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`Failed to fetch rates: ${res.status}`);
  const data: LiveRateResponse = await res.json();
  if (data.result !== "success") throw new Error("API returned error");
  return data.rates;
}

/**
 * Convert a live API rate (1 USD = X units) to a CurrencyRate object
 * compatible with the exchange calculator.
 *
 * For currencies where 1 USD > 1 unit (e.g. GBP 0.73), the currency is "stronger":
 *   is_stronger = -1, rate = USD per 1 unit = 1/apiRate
 *
 * For currencies where 1 USD < 1 unit (e.g. JPY 157), USD is "stronger":
 *   is_stronger = +1, rate = units per 1 USD = apiRate
 *
 * Since these are mid-market rates, buy_rate = sell_rate = market_rate
 * (no spread — the spread comes from EUR's settings config).
 */
export function apiRateToCurrencyRate(
  code: string,
  apiRate: number,
): CurrencyRate {
  if (apiRate < 1) {
    // Currency is stronger than USD (e.g. GBP: 0.73 means 1 USD = 0.73 GBP → 1 GBP = 1.37 USD)
    const rateUsdPerUnit = 1 / apiRate;
    return {
      to_code: code,
      market_rate: rateUsdPerUnit,
      buy_rate: rateUsdPerUnit,
      sell_rate: rateUsdPerUnit,
      is_stronger: -1,
    };
  } else {
    // USD is stronger (e.g. JPY: 157 means 1 USD = 157 JPY)
    return {
      to_code: code,
      market_rate: apiRate,
      buy_rate: apiRate,
      sell_rate: apiRate,
      is_stronger: 1,
    };
  }
}

/**
 * Fetch live rates and convert to CurrencyRate[] for the exchange calculator.
 * Excludes USD, LBP, and EUR (those come from local settings).
 */
export async function fetchLiveCurrencyRates(): Promise<CurrencyRate[]> {
  const rawRates = await fetchLiveRates();
  const result: CurrencyRate[] = [];

  for (const [code, rate] of Object.entries(rawRates)) {
    if (EXCLUDED_CURRENCIES.has(code)) continue;
    result.push(apiRateToCurrencyRate(code, rate));
  }

  // Sort by common currencies first
  const priority = ["GBP", "CAD", "AUD", "CHF", "JPY", "AED", "SAR", "TRY"];
  result.sort((a, b) => {
    const ai = priority.indexOf(a.to_code);
    const bi = priority.indexOf(b.to_code);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.to_code.localeCompare(b.to_code);
  });

  return result;
}

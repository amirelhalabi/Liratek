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
  /** Unix seconds when the feed publishes next — the free tier is ~24h. */
  time_next_update_unix: number;
  rates: Record<string, number>;
}

/**
 * One fetch of the feed, with the provenance needed to display it honestly.
 *
 * `rates` keeps the historical filtering (USD/LBP/EUR removed — those are
 * locally configured and the currency selector adds them itself), so existing
 * callers are unaffected. `marketRates` is the full set minus USD, for the
 * market-reference panel: seeing the market's LBP and EUR next to the shop's
 * own configured rates is the point of that panel.
 */
export interface LiveRatesSnapshot {
  /** Untouched `rates` map from the response (1 USD = X units). */
  raw: Record<string, number>;
  rates: CurrencyRate[];
  marketRates: CurrencyRate[];
  /** The API's own publish time, verbatim. */
  lastUpdatedUtc: string;
  nextUpdateUnix: number;
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
 * Display symbols for common currencies. Lives here beside CURRENCY_NAMES so
 * currency display metadata has one home (it was previously duplicated inside
 * the Exchange page).
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CHF: "Fr",
  CAD: "C$",
  AUD: "A$",
  TRY: "₺",
  INR: "₹",
  CNY: "¥",
  KRW: "₩",
  BRL: "R$",
  MXN: "$",
  ZAR: "R",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  CZK: "Kč",
  HUF: "Ft",
  ILS: "₪",
  SGD: "S$",
  HKD: "HK$",
  NZD: "NZ$",
  PHP: "₱",
  IDR: "Rp",
  MYR: "RM",
  RUB: "₽",
  NGN: "₦",
  EGP: "E£",
  UAH: "₴",
};

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code;
}

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

/** Common currencies first, then alphabetical. */
const PRIORITY_CODES = ["GBP", "CAD", "AUD", "CHF", "JPY", "AED", "SAR", "TRY"];

function sortByPriority(list: CurrencyRate[]): CurrencyRate[] {
  return list.sort((a, b) => {
    const ai = PRIORITY_CODES.indexOf(a.to_code);
    const bi = PRIORITY_CODES.indexOf(b.to_code);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.to_code.localeCompare(b.to_code);
  });
}

// ─── Cache ────────────────────────────────────────────────────────────────────
//
// The feed publishes roughly once every 24 hours and tells us exactly when the
// next one lands (`time_next_update_unix`), so the cache is valid until that
// moment — no arbitrary TTL guess. Without this, every mount of the Exchange
// page and every open of the drawer top-up modal re-fetched a payload that had
// not changed since the previous day.

let cached: LiveRatesSnapshot | null = null;
let inflight: Promise<LiveRatesSnapshot> | null = null;

/** True while the cached snapshot predates the feed's next publish. */
function isFresh(snapshot: LiveRatesSnapshot): boolean {
  return Date.now() / 1000 < snapshot.nextUpdateUnix;
}

/**
 * Fetch (or reuse) one snapshot of the feed. Concurrent callers share a single
 * in-flight request.
 */
export async function fetchLiveRatesSnapshot(): Promise<LiveRatesSnapshot> {
  if (cached && isFresh(cached)) return cached;
  if (inflight) return inflight;

  const request = (async (): Promise<LiveRatesSnapshot> => {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`Failed to fetch rates: ${res.status}`);
      const data: LiveRateResponse = await res.json();
      if (data.result !== "success") throw new Error("API returned error");

      const rates: CurrencyRate[] = [];
      const marketRates: CurrencyRate[] = [];
      for (const [code, rate] of Object.entries(data.rates)) {
        // USD is the base — "1 USD = 1 USD" is noise in every view.
        if (code === "USD") continue;
        const converted = apiRateToCurrencyRate(code, rate);
        marketRates.push(converted);
        if (!EXCLUDED_CURRENCIES.has(code)) rates.push(converted);
      }

      cached = {
        raw: data.rates,
        rates: sortByPriority(rates),
        marketRates: sortByPriority(marketRates),
        lastUpdatedUtc: data.time_last_update_utc,
        nextUpdateUnix: data.time_next_update_unix,
      };
      return cached;
    } finally {
      inflight = null;
    }
  })();

  inflight = request;
  return request;
}

/**
 * Fetch live rates and convert to CurrencyRate[] for the exchange calculator.
 * Excludes USD, LBP, and EUR (those come from local settings).
 */
export async function fetchLiveCurrencyRates(): Promise<CurrencyRate[]> {
  return (await fetchLiveRatesSnapshot()).rates;
}

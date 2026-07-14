import { type CurrencyInfo, type Money, MoneyError } from "./types";

/** Per-currency formatting/tolerance registry. Long-term this is fed from the
 *  `currencies` DB table; the static map covers the currencies live today.
 *  Adding a currency here (+ a rate row) is ALL a new currency requires. */
export type CurrencyRegistry = Record<string, CurrencyInfo>;

export const DEFAULT_CURRENCIES: CurrencyRegistry = {
  USD: { code: "USD", symbol: "$", decimals: 2, epsilon: 0.01 },
  // 0.5 LBP tolerance mirrors the settled-balance check used by the Debts page.
  LBP: { code: "LBP", symbol: "LBP", decimals: 0, epsilon: 0.5 },
};

/** Look up a currency; unknown codes get a safe 2-decimal default so a new
 *  currency arriving via data (not code) degrades gracefully. */
export function currencyInfo(
  code: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCIES,
): CurrencyInfo {
  return registry[code] ?? { code, symbol: code, decimals: 2, epsilon: 0.01 };
}

/** Round to the currency's precision (LBP whole, USD/EUR cents). */
export function roundForCurrency(
  m: Money,
  registry: CurrencyRegistry = DEFAULT_CURRENCIES,
): Money {
  if (!Number.isFinite(m.amount)) {
    throw new MoneyError(
      `roundForCurrency: non-finite amount for ${m.currency}`,
    );
  }
  const { decimals } = currencyInfo(m.currency, registry);
  const factor = 10 ** decimals;
  return {
    amount: Math.round(m.amount * factor) / factor,
    currency: m.currency,
  };
}

/** True when the amount is within the currency's settled-zero tolerance. */
export function isSettled(
  m: Money,
  registry: CurrencyRegistry = DEFAULT_CURRENCIES,
): boolean {
  return Math.abs(m.amount) < currencyInfo(m.currency, registry).epsilon;
}

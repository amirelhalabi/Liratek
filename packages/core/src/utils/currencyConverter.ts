/**
 * Currency Converter — Universal Exchange Rate Engine
 *
 * Architecture:
 *   - USD is the base/pivot currency for all exchanges
 *   - One DB row per non-USD currency: (to_code, market_rate, delta, is_stronger)
 *   - Universal formula: rate = market_rate + is_stronger × (action × delta)
 *   - Direct exchanges (X ↔ USD): 1 leg, 1 profit
 *   - Cross-currency exchanges (X ↔ Y, neither USD): 2 legs via USD, 2 profits
 *   - Adding a new currency = adding 1 DB row, zero code changes
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const BASE_CURRENCY = "USD" as const;

/**
 * action = GIVE_USD: we output USD (buying customer's non-USD currency)
 * action = TAKE_USD: we receive USD (selling our non-USD currency to customer)
 */
export const GIVE_USD = +1 as const;
export const TAKE_USD = -1 as const;
export type USDAction = typeof GIVE_USD | typeof TAKE_USD;

// ─── Interfaces ───────────────────────────────────────────────────────────────

/**
 * One row from the exchange_rates table.
 * Represents the rate of a non-USD currency vs USD.
 */
export interface CurrencyRate {
  to_code: string; // non-USD currency code (e.g. 'LBP', 'EUR')
  market_rate: number; // mid-market rate
  delta: number; // half-spread (buy/sell deviate from market by this amount)
  is_stronger: 1 | -1; // +1: USD stronger (rate = units per 1 USD, e.g. LBP)
  // -1: currency stronger (rate = USD per 1 unit, e.g. EUR)
}

/**
 * One leg of an exchange transaction.
 * Direct exchanges have 1 leg; cross-currency exchanges have 2.
 */
export interface ExchangeLeg {
  fromCurrency: string;
  toCurrency: string;
  amountIn: number;
  amountOut: number;
  rate: number; // actual rate used (from formula)
  marketRate: number; // mid-market rate (for audit trail)
  profitUsd: number; // profit on this leg, expressed in USD
}

/**
 * Full result of a calculateExchange() call.
 */
export interface CurrencyExchangeResult {
  legs: ExchangeLeg[]; // 1 for direct, 2 for cross-currency
  totalAmountOut: number; // final amount customer receives
  totalProfitUsd: number; // sum of all legs' profit in USD
  viaCurrency: string | null; // 'USD' for cross-currency, null for direct
}

// ─── Core Formula ─────────────────────────────────────────────────────────────

/**
 * Universal rate formula.
 *
 *   rate = market_rate + is_stronger × (action × delta)
 *
 * Examples (LBP: market=89500, delta=500, is_stronger=+1):
 *   TAKE_USD (-1): 89500 + 1×(-1×500) = 89,000  ← we take USD (give fewer LBP)
 *   GIVE_USD (+1): 89500 + 1×(+1×500) = 90,000  ← we give USD (charge more LBP)
 *
 * Examples (EUR: market=1.18, delta=0.02, is_stronger=-1):
 *   GIVE_USD (+1): 1.18 + (-1)×(+1×0.02) = 1.16  ← we buy EUR cheap
 *   TAKE_USD (-1): 1.18 + (-1)×(-1×0.02) = 1.20  ← we sell EUR expensive
 */
export function computeRate(
  currencyRate: CurrencyRate,
  action: USDAction,
): number {
  return (
    currencyRate.market_rate +
    currencyRate.is_stronger * (action * currencyRate.delta)
  );
}

// ─── USD Conversions ──────────────────────────────────────────────────────────

/**
 * Convert an amount of a non-USD currency TO USD.
 *
 * is_stronger = +1 (LBP): divide by rate  (e.g. 90,000 LBP ÷ 90,000 = 1 USD)
 * is_stronger = -1 (EUR): multiply by rate (e.g. 10 EUR × 1.16 = 11.6 USD)
 */
export function convertToUSD(
  amount: number,
  currencyRate: CurrencyRate,
  action: USDAction,
): { amountUSD: number; rate: number } {
  const rate = computeRate(currencyRate, action);
  const amountUSD =
    currencyRate.is_stronger === 1 ? amount / rate : amount * rate;
  return { amountUSD, rate };
}

/**
 * Convert a USD amount TO a non-USD currency.
 *
 * is_stronger = +1 (LBP): multiply by rate (e.g. 1 USD × 89,000 = 89,000 LBP)
 * is_stronger = -1 (EUR): divide by rate   (e.g. 1.20 USD ÷ 1.20 = 1 EUR)
 */
export function convertFromUSD(
  amountUSD: number,
  currencyRate: CurrencyRate,
  action: USDAction,
): { amountOut: number; rate: number } {
  const rate = computeRate(currencyRate, action);
  const amountOut =
    currencyRate.is_stronger === 1 ? amountUSD * rate : amountUSD / rate;
  return { amountOut, rate };
}

// ─── Profit Calculation ───────────────────────────────────────────────────────

/**
 * Calculate profit in USD for a single exchange leg.
 *
 * For is_stronger = +1 (LBP-like):
 *   profit = amount_usd_transacted × delta / market_rate
 *
 * For is_stronger = -1 (EUR-like):
 *   profit = amount_in_currency × delta
 *
 * @param amountIn  Amount in the FROM currency of this leg
 * @param currencyRate  The non-USD currency rate entry
 */
export function computeLegProfitUsd(
  amountIn: number,
  currencyRate: CurrencyRate,
): number {
  const { market_rate, delta, is_stronger } = currencyRate;
  if (is_stronger === 1) {
    // LBP-like: spread is in LBP terms, convert to USD
    const amountUsd = amountIn / market_rate;
    return amountUsd * delta;
  } else {
    // EUR-like: spread is already in USD terms
    return amountIn * delta;
  }
}

// ─── Rate Lookup ──────────────────────────────────────────────────────────────

/**
 * Find the rate entry for a non-USD currency. Throws if not found.
 */
export function findCurrencyRate(
  code: string,
  rates: CurrencyRate[],
): CurrencyRate {
  const rate = rates.find((r) => r.to_code === code);
  if (!rate) {
    throw new Error(
      `No exchange rate found for currency: ${code}. Add it in Settings → Rates.`,
    );
  }
  return rate;
}

// ─── Master Exchange Calculator ───────────────────────────────────────────────

/**
 * Calculate a complete exchange for any currency pair.
 *
 * - Direct (X ↔ USD): 1 leg, viaCurrency = null
 * - Cross-currency (X ↔ Y, neither USD): 2 legs via USD, viaCurrency = 'USD'
 *
 * Works for N currencies — no hardcoded pairs. Adding a new currency
 * only requires a new row in exchange_rates.
 *
 * @param fromCurrency  Currency the customer is giving
 * @param toCurrency    Currency the customer wants to receive
 * @param amountIn      Amount the customer is giving
 * @param rates         All CurrencyRate entries loaded from DB
 */
export function calculateExchange(
  fromCurrency: string,
  toCurrency: string,
  amountIn: number,
  rates: CurrencyRate[],
): CurrencyExchangeResult {
  if (fromCurrency === toCurrency) {
    throw new Error(`Cannot exchange a currency for itself: ${fromCurrency}`);
  }
  if (amountIn <= 0) {
    throw new Error(`Exchange amount must be positive, got: ${amountIn}`);
  }

  // ── Direct: USD → X ────────────────────────────────────────────────────────
  if (fromCurrency === BASE_CURRENCY) {
    const currRate = findCurrencyRate(toCurrency, rates);
    const { amountOut, rate } = convertFromUSD(amountIn, currRate, TAKE_USD);
    const profitUsd = computeLegProfitUsd(amountIn, currRate);
    const leg: ExchangeLeg = {
      fromCurrency,
      toCurrency,
      amountIn,
      amountOut,
      rate,
      marketRate: currRate.market_rate,
      profitUsd,
    };
    return {
      legs: [leg],
      totalAmountOut: amountOut,
      totalProfitUsd: profitUsd,
      viaCurrency: null,
    };
  }

  // ── Direct: X → USD ────────────────────────────────────────────────────────
  if (toCurrency === BASE_CURRENCY) {
    const currRate = findCurrencyRate(fromCurrency, rates);
    const { amountUSD, rate } = convertToUSD(amountIn, currRate, GIVE_USD);
    const profitUsd = computeLegProfitUsd(amountIn, currRate);
    const leg: ExchangeLeg = {
      fromCurrency,
      toCurrency,
      amountIn,
      amountOut: amountUSD,
      rate,
      marketRate: currRate.market_rate,
      profitUsd,
    };
    return {
      legs: [leg],
      totalAmountOut: amountUSD,
      totalProfitUsd: profitUsd,
      viaCurrency: null,
    };
  }

  // ── Cross-currency: X → USD → Y ────────────────────────────────────────────
  const fromRate = findCurrencyRate(fromCurrency, rates);
  const toRate = findCurrencyRate(toCurrency, rates);

  // Leg 1: FROM → USD (we give USD internally)
  const leg1Result = convertToUSD(amountIn, fromRate, GIVE_USD);
  const leg1ProfitUsd = computeLegProfitUsd(amountIn, fromRate);
  const leg1: ExchangeLeg = {
    fromCurrency,
    toCurrency: BASE_CURRENCY,
    amountIn,
    amountOut: leg1Result.amountUSD,
    rate: leg1Result.rate,
    marketRate: fromRate.market_rate,
    profitUsd: leg1ProfitUsd,
  };

  // Leg 2: USD → TO (we take USD internally, give TO currency to customer)
  const leg2Result = convertFromUSD(leg1Result.amountUSD, toRate, TAKE_USD);
  const leg2ProfitUsd = computeLegProfitUsd(leg1Result.amountUSD, toRate);
  const leg2: ExchangeLeg = {
    fromCurrency: BASE_CURRENCY,
    toCurrency,
    amountIn: leg1Result.amountUSD,
    amountOut: leg2Result.amountOut,
    rate: leg2Result.rate,
    marketRate: toRate.market_rate,
    profitUsd: leg2ProfitUsd,
  };

  const totalProfitUsd = leg1ProfitUsd + leg2ProfitUsd;
  return {
    legs: [leg1, leg2],
    totalAmountOut: leg2Result.amountOut,
    totalProfitUsd,
    viaCurrency: BASE_CURRENCY,
  };
}

/**
 * Get a human-readable effective rate for display in the UI.
 * Returns the rate the customer sees (e.g. "1 USD = 89,000 LBP" or "1 EUR = 1.16 USD").
 */
export function getDisplayRate(
  fromCurrency: string,
  toCurrency: string,
  rates: CurrencyRate[],
): number {
  if (fromCurrency === BASE_CURRENCY) {
    const cr = findCurrencyRate(toCurrency, rates);
    return computeRate(cr, TAKE_USD);
  }
  if (toCurrency === BASE_CURRENCY) {
    const cr = findCurrencyRate(fromCurrency, rates);
    return computeRate(cr, GIVE_USD);
  }
  // Cross-currency: show the combined rate (how many toCurrency per 1 fromCurrency)
  const result = calculateExchange(fromCurrency, toCurrency, 1, rates);
  return result.totalAmountOut;
}

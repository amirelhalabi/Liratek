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

import { marketRateToUsdPerUnit } from "./lotMarketRate.js";

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
  market_rate: number; // mid-market rate (for display / audit)
  buy_rate: number; // rate when we buy the currency (favorable to us)
  sell_rate: number; // rate when we sell the currency (favorable to us)
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
 * Universal rate lookup.
 *
 * Uses buy_rate or sell_rate directly based on the action and currency strength.
 *
 * When is_stronger × action < 0 → buy_rate (favorable to us)
 * When is_stronger × action > 0 → sell_rate (favorable to us)
 *
 * Examples (LBP: buy=89000, sell=90000, is_stronger=+1):
 *   TAKE_USD (-1): 1×(-1) = -1 → buy_rate = 89,000  ← we give fewer LBP
 *   GIVE_USD (+1): 1×(+1) = +1 → sell_rate = 90,000  ← customer gives more LBP
 *
 * Examples (EUR: buy=1.16, sell=1.20, is_stronger=-1):
 *   GIVE_USD (+1): (-1)×(+1) = -1 → buy_rate = 1.16  ← we buy EUR cheap
 *   TAKE_USD (-1): (-1)×(-1) = +1 → sell_rate = 1.20  ← we sell EUR expensive
 */
export function computeRate(
  currencyRate: CurrencyRate,
  action: USDAction,
): number {
  return currencyRate.is_stronger * action < 0
    ? currencyRate.buy_rate
    : currencyRate.sell_rate;
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
 *   USD→LBP (fromCurrencyIsUsd=true):  profit = amountIn × halfSpread / market_rate
 *   LBP→USD (fromCurrencyIsUsd=false): profit = amountIn × halfSpread / market_rate²
 *
 * For is_stronger = -1 (EUR-like):
 *   EUR→USD (fromCurrencyIsUsd=false): profit = amountIn × halfSpread
 *   USD→EUR (fromCurrencyIsUsd=true):  profit = (amountIn / market_rate) × halfSpread
 *
 * @param amountIn          Amount in the FROM currency of this leg
 * @param currencyRate      The non-USD currency rate entry
 * @param fromCurrencyIsUsd true when FROM currency is USD (USD→X legs), false when FROM is non-USD (X→USD legs)
 */
export function computeLegProfitUsd(
  amountIn: number,
  currencyRate: CurrencyRate,
  fromCurrencyIsUsd = true,
): number {
  const { market_rate, buy_rate, sell_rate, is_stronger } = currencyRate;
  const spread = sell_rate - buy_rate;
  if (is_stronger === 1) {
    // LBP-like: spread is in LBP/USD — must convert profit to USD
    if (fromCurrencyIsUsd) {
      // USD → LBP: amountIn is in USD; profit in LBP = amountIn × spread/2; ÷market_rate → USD
      return (amountIn * (spread / 2)) / market_rate;
    } else {
      // LBP → USD: amountIn is in LBP; convert to USD first, then apply spread ratio
      return (amountIn * (spread / 2)) / (market_rate * market_rate);
    }
  } else {
    // EUR-like: spread is in USD/EUR
    if (fromCurrencyIsUsd) {
      // USD → EUR: amountIn is in USD; convert to EUR equivalent first
      return (amountIn / market_rate) * (spread / 2);
    } else {
      // EUR → USD: amountIn is in EUR; spread × EUR amount = USD profit
      return amountIn * (spread / 2);
    }
  }
}

/**
 * Calculate the SIGNED profit-vs-market on a single leg where the operator
 * manually overrode the applied rate (the Exchange page's per-leg rate
 * edit — `applyCustomRates`, `frontend/src/features/exchange/pages/Exchange
 * /index.tsx`). This is the ONE definition of this math (rule 14),
 * replacing a frontend-local `Math.abs(marketOut − amountOut)` copy that
 * silently turned every below-market override (the shop giving the
 * customer a BETTER deal than market) into a phantom POSITIVE profit.
 *
 *   profitUsd = (marketOut − actualOut) × usdPerOutUnit
 *
 * `marketOut`/`actualOut` are both denominated in the leg's OUT currency —
 * what the customer would have received at the market rate vs what they
 * actually received at the operator's applied rate. `outCurrencyRate` is
 * `null` when the OUT currency IS USD (`usdPerOutUnit` = 1); otherwise pass
 * the OUT currency's own rate row (only `market_rate`/`is_stronger` are
 * read — delegates to `marketRateToUsdPerUnit`, `utils/lotMarketRate.ts`):
 * `is_stronger = +1` (LBP-like, `market_rate` is units-per-USD) divides by
 * `market_rate`; `is_stronger = -1` (EUR-like, `market_rate` is
 * USD-per-unit) multiplies by it (i.e. IS the USD-per-unit rate already).
 *
 * SIGN CONVENTION — never wrap the result in `Math.abs`:
 *   +ve → the shop keeps value vs market (pays out LESS than market, or
 *         acquires the FROM currency CHEAPER than market) — a real gain.
 *   −ve → the shop gave the customer BETTER than market — a real LOSS.
 *    0  → applied rate === market rate.
 *
 * Worked anchors (see currencyConverter.test.ts):
 *   USD→LBP payout of 116 USD, applied 89000 vs market 89500:
 *     marketOut = 116×89500 = 10,382,000 LBP
 *     actualOut = 116×89000 = 10,324,000 LBP  (customer got FEWER LBP)
 *     → (10,382,000 − 10,324,000) × (1/89500) = +0.6480
 *   Same payout at applied 90000 (customer gets MORE LBP):
 *     actualOut = 116×90000 = 10,440,000
 *     → (10,382,000 − 10,440,000) × (1/89500) = −0.6480
 *   EUR→USD leg, shop buys 100 EUR at applied 1.12 vs market 1.18
 *   (OUT currency is USD here, so `outCurrencyRate: null`, usdPerOutUnit=1):
 *     marketOut = 100×1.18 = 118, actualOut = 100×1.12 = 112 → +6.00
 *   Same buy at applied 1.20 (shop overpaid the customer in USD):
 *     actualOut = 100×1.20 = 120 → (118 − 120) × 1 = −2.00
 *   applied === market → 0 in every orientation.
 *
 * Callable for a direct-pair override (single leg, OUT = whichever side
 * isn't USD) and for each leg of a cross override independently — cross
 * leg1 (X→USD, OUT=USD → `outCurrencyRate: null`) and cross leg2 (USD→Y,
 * OUT=Y → `outCurrencyRate` = Y's rate row). The caller only needs to hand
 * in the two OUT-currency amounts it already computes for display
 * (`marketOut`, `actualOut`) plus the rate row (or `null`) — no other
 * local math required.
 */
export function computeOverrideLegProfitUsd(
  marketOut: number,
  actualOut: number,
  outCurrencyRate: Pick<CurrencyRate, "market_rate" | "is_stronger"> | null,
): number {
  const usdPerOutUnit = outCurrencyRate
    ? marketRateToUsdPerUnit(
        outCurrencyRate.market_rate,
        outCurrencyRate.is_stronger,
      )
    : 1;
  return (marketOut - actualOut) * usdPerOutUnit;
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
    const profitUsd = computeLegProfitUsd(amountIn, currRate, false);
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
  const leg1ProfitUsd = computeLegProfitUsd(amountIn, fromRate, false);
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

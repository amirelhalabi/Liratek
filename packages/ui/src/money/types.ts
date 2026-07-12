/**
 * Money domain types — the vocabulary of the multi-currency payment engine.
 *
 * Design (docs/plans/MULTI_CURRENCY_PAYMENT_PLAN.md):
 *  - No bare money numbers: every amount carries its currency (`Money`).
 *  - Rates are a table quoted against ONE base currency, so any-to-any
 *    conversion (EUR→LBP) goes through the base without new code paths.
 *  - Conversion happens only at a currency boundary — never within one.
 */

/** An amount that always carries its currency. Never pass bare numbers. */
export interface Money {
  amount: number;
  currency: string;
}

/** Which side of the quote a flow converts at — a business decision made by
 *  the caller (e.g. debt repayments use "buy", owner decision 2026-07-06),
 *  never defaulted silently inside the engine. */
export type RateSide = "buy" | "sell";

export interface RatePair {
  buy: number;
  sell: number;
}

/**
 * Exchange rates quoted against one base currency.
 *
 * `rates[code]` = units of `code` per ONE unit of `base`, so with
 * `base: "USD"`, `rates.LBP.buy = 89_000` reads "1 USD = 89,000 LBP" —
 * the same orientation the app quotes everywhere. The base itself needs
 * no entry (implicitly 1).
 */
export interface RateTable {
  base: string;
  rates: Record<string, RatePair>;
}

/** Formatting + tolerance knowledge for one currency. */
export interface CurrencyInfo {
  code: string;
  symbol: string;
  /** Decimal places amounts are expressed in (USD 2, LBP 0). */
  decimals: number;
  /** Amounts with |amount| below this count as settled/zero. */
  epsilon: number;
}

/** One conversion performed during allocation — the audit trail that also
 *  tells the UI which currency pairs are actively being bridged (and so
 *  which rate fields to render). */
export interface CrossApplication {
  from: Money;
  to: Money;
  /** Units of `to.currency` per one unit of `from.currency`. */
  rateUsed: number;
}

export interface AllocationResult {
  /** Still owed after this payment set, per currency — NATIVE amounts,
   *  rate-independent by construction for same-currency payments. */
  remaining: Money[];
  /** Every cross-currency application that happened. */
  crossCurrencyApplied: CrossApplication[];
  /** True excess to hand back, kept in the tender currency (D1). */
  change: Money[];
}

/** Typed error for degenerate inputs (missing/zero/NaN rate, bad amount).
 *  The engine never lets NaN escape into a result. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

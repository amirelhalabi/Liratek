import {
  type Money,
  MoneyError,
  type RateSide,
  type RateTable,
} from "./types";

/** Units of `code` per one unit of the table's base (base itself = 1).
 *  Degenerate rates (missing, 0, NaN, negative) throw — never NaN out. */
function unitsPerBase(
  code: string,
  rates: RateTable,
  side: RateSide,
): number {
  if (code === rates.base) return 1;
  const rate = rates.rates[code]?.[side];
  if (!Number.isFinite(rate) || rate === undefined || rate <= 0) {
    throw new MoneyError(
      `convert: no usable ${side} rate for ${code} (base ${rates.base})`,
    );
  }
  return rate;
}

/** Units of `to` per one unit of `from` — e.g. USD→LBP at 89,000. */
export function crossRate(
  from: string,
  to: string,
  rates: RateTable,
  side: RateSide,
): number {
  if (from === to) return 1;
  return unitsPerBase(to, rates, side) / unitsPerBase(from, rates, side);
}

/**
 * Convert Money into another currency through the table's base.
 *
 * Identity invariant (I3): converting to the SAME currency returns the input
 * unchanged and consults no rate — same-currency math is rate-independent by
 * construction. Results are NOT rounded here; round once at the output
 * boundary with roundForCurrency.
 */
export function convert(
  m: Money,
  to: string,
  rates: RateTable,
  side: RateSide,
): Money {
  if (m.currency === to) return m;
  if (!Number.isFinite(m.amount)) {
    throw new MoneyError(`convert: non-finite amount for ${m.currency}`);
  }
  return { amount: m.amount * crossRate(m.currency, to, rates, side), currency: to };
}

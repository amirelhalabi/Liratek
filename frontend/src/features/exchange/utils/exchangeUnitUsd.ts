import type { CurrencyExchangeResult } from "@liratek/core";

/**
 * USD and LBP are the currencies a client's account is kept in. Any other
 * currency put on the account is converted to USD at a typed rate
 * (LIRA-369). Mirrors core's `isAccountCurrency` (validators/exchange.ts),
 * kept local because the page's tests stub `@liratek/core` by hand.
 */
export function isUsdOrLbp(code: string): boolean {
  return code === "USD" || code === "LBP";
}

/**
 * LIRA-369 (research R5) — the ONE seed for the typed account rate
 * "1 <currency> = X USD": the exchange's OWN USD value per unit of that
 * currency, so putting the amount on the account gives the customer exactly
 * the USD the exchange priced it at.
 *
 * - Direct trade (one leg, always against USD): the USD side ÷ the quantity.
 * - Cross trade (X → USD → Y): the USD notional of the leg that touches the
 *   currency ÷ its quantity (leg 1's USD out for X, leg 2's USD in for Y).
 *
 * `sent` is what the page actually submits as amountIn / amountOut (amountOut
 * is rounded to the currency's decimals). Dividing by the SAME rounded
 * quantity the server books keeps `quantity × rate` equal to the USD figure
 * (same reasoning as the lot preview, LIRA-185 lead 4).
 *
 * Returns null when the currency is not one of the exchange's two sides or
 * the figures cannot give a positive rate.
 */
export function exchangeUnitUsd(
  result: CurrencyExchangeResult,
  currency: string,
  sent?: { amountIn: number; amountOut: number },
): number | null {
  if (currency === "USD") return 1;
  const legs = result.legs;
  if (legs.length === 0) return null;
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const direct = legs.length === 1;

  let usd: number;
  let qty: number;
  if (first.fromCurrency === currency) {
    qty = sent?.amountIn ?? first.amountIn;
    usd = direct && sent ? sent.amountOut : first.amountOut;
  } else if (last.toCurrency === currency) {
    qty = sent?.amountOut ?? last.amountOut;
    usd = direct && sent ? sent.amountIn : last.amountIn;
  } else {
    return null;
  }
  const unit = usd / qty;
  return Number.isFinite(unit) && unit > 0 ? unit : null;
}

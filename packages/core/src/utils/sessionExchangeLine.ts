/**
 * LIRA-380 — the ONE rule for an exchange added to a customer-session basket,
 * shared by the checkout modal (`splitBasketCashSides`, the basket totals) and
 * the server (`SessionCheckoutService`'s session link and totals) — rule 14.
 *
 * An exchange line has TWO customer sides, unlike every other basket line:
 *  - what the customer GIVES (`amountIn` of `fromCurrency`) is a CHARGE —
 *    collected by the basket's one pooled payment;
 *  - what the customer RECEIVES (`amountOut` of `toCurrency`) is a PAYOUT —
 *    paid out by its own gross PAYOUT leg, never netted against the charge
 *    at the checkout's rate (owner 2026-11-11: "The rate of the session
 *    should not affect the rate of the exchange transaction").
 *
 * Only USD and LBP sides are basket money (every basket bucket and the
 * session link's columns are USD/LBP). A side in another currency (the euros
 * of a USD → EUR exchange) is paid or taken by the exchange itself at
 * checkout, as its own CASH line in General — it reads as `null` here.
 *
 * Browser-safe leaf (rule 29): reachable from `browser.ts`, imports nothing.
 */

/** The channel a basket line is replayed on at checkout (the Exchange IPC
 *  channel). Persisted in `session_cart_items.ipc_channel`. */
export const EXCHANGE_CART_CHANNEL = "exchange:add-transaction";

export interface BasketLineSide {
  currency: "USD" | "LBP";
  amount: number;
}

export interface ExchangeLineSides {
  /** What the customer gives, when it is USD/LBP. */
  charge: BasketLineSide | null;
  /** What the customer receives, when it is USD/LBP. */
  payout: BasketLineSide | null;
}

/** True for a basket line that is an exchange. */
export function isExchangeBasketLine(item: {
  ipcChannel?: string | null;
}): boolean {
  return item.ipcChannel === EXCHANGE_CART_CHANNEL;
}

function side(currency: unknown, amount: unknown): BasketLineSide | null {
  if (currency !== "USD" && currency !== "LBP") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { currency, amount: n };
}

/** The customer's two sides of an exchange line (USD/LBP sides only). */
export function sessionExchangeLineSides(
  formData: Record<string, unknown> | null | undefined,
): ExchangeLineSides {
  if (!formData) return { charge: null, payout: null };
  return {
    charge: side(formData.fromCurrency, formData.amountIn),
    payout: side(formData.toCurrency, formData.amountOut),
  };
}

/** The signed customer amounts the session link stores for an exchange line:
 *  given +, received −, per currency. */
export function sessionExchangeLineLink(
  formData: Record<string, unknown> | null | undefined,
): { amountUsd: number; amountLbp: number } {
  const { charge, payout } = sessionExchangeLineSides(formData);
  let amountUsd = 0;
  let amountLbp = 0;
  if (charge?.currency === "USD") amountUsd += charge.amount;
  if (charge?.currency === "LBP") amountLbp += charge.amount;
  if (payout?.currency === "USD") amountUsd -= payout.amount;
  if (payout?.currency === "LBP") amountLbp -= payout.amount;
  return { amountUsd, amountLbp };
}

/** The basket line's own `amount`/`currency`: the side the customer gives;
 *  when that side is not USD/LBP, the side they receive (negative); 0 USD
 *  when neither side is USD/LBP. */
export function sessionExchangeCartAmount(
  formData: Record<string, unknown> | null | undefined,
): BasketLineSide {
  const { charge, payout } = sessionExchangeLineSides(formData);
  if (charge) return charge;
  if (payout) return { currency: payout.currency, amount: -payout.amount };
  return { currency: "USD", amount: 0 };
}

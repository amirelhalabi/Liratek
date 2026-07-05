import type { CartItem } from "../types/cart";

/**
 * Customer-perspective reading of a Binance basket item.
 *
 * The session basket shows ONE perspective — the customer's: what they pay
 * (+) or get paid (−), in the currency that changes hands with THEM. For
 * Binance that is always CASH (USD): the stored `amount` is that cash side
 * (SEND: +amount+fee the customer pays; RECEIVE: −(amount−fee) the shop pays
 * out). The USDT quantity is the SERVICE being performed and lives in the
 * item label; the wallet gaining/losing USDT is shop bookkeeping that
 * belongs to the transactions view — never to the basket (no cart line
 * shows the Katsh drawer draw-down either).
 *
 * The item's "USDT" currency is a MECHANICAL flag only: it keeps the item
 * out of the pooled basket payment because FinancialServiceRepository
 * self-posts the cash movement at checkout replay. Do not render it —
 * rendering `amount` as "USDT" once read as "the wallet loses 50 USDT" on a
 * cash out. Returns null for non-Binance items.
 */
export function binanceCashSide(
  item: Pick<CartItem, "module" | "amount">,
): { cashUsd: number } | null {
  if (item.module !== "binance_receive" && item.module !== "binance_send") {
    return null;
  }
  return { cashUsd: item.amount };
}

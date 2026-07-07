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

/**
 * GROSS split of a basket into charges (customer pays, +) and cash-out payouts
 * (shop pays, −), per currency, WITHOUT netting them against each other.
 *
 * A $10 charge and a $20 cash-out must surface on the Debts page as a $10 debt
 * AND a $20 credit (net −$10) — never collapsed into one −$10 line. So charges
 * and payouts are accumulated into SEPARATE buckets: the charges seed the
 * pooled payment / basket debt, the payouts become the cash payout or the
 * on-account store credit. Netting here (returning `usd = charge − payout`)
 * is the bug this guards — the canceled amounts would vanish from the ledger.
 *
 * `binanceCashSide` folds a Binance item's USDT tag into its USD cash side;
 * every other item contributes its own `amount`/`currency`.
 */
export function splitBasketCashSides(
  items: Array<Pick<CartItem, "module" | "amount" | "currency">>,
): { chargeUsd: number; chargeLbp: number; payoutUsd: number; payoutLbp: number } {
  let chargeUsd = 0,
    chargeLbp = 0,
    payoutUsd = 0,
    payoutLbp = 0;
  for (const item of items) {
    const binance = binanceCashSide(item);
    const amt = binance ? binance.cashUsd : item.amount;
    const ccy = binance ? "USD" : item.currency;
    if (amt >= 0) {
      if (ccy === "USD") chargeUsd += amt;
      else if (ccy === "LBP") chargeLbp += amt;
    } else {
      if (ccy === "USD") payoutUsd += -amt;
      else if (ccy === "LBP") payoutLbp += -amt;
    }
  }
  return { chargeUsd, chargeLbp, payoutUsd, payoutLbp };
}

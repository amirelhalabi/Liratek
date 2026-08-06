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
 * The item's "USDT" currency is a MECHANICAL flag only: `splitBasketCashSides`
 * below folds it into the USD cash-side bucket (charge or payout) instead of
 * giving it its own currency bucket, which is what actually keeps a Binance
 * item out of a phantom "USDT total" in the pooled basket payment / debt.
 * There is no more separate self-posted replay path for this — the gross
 * charge/payout split (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.5, Phase F) is
 * now the one model every session-basket item goes through, cashout or not.
 * Do not render the raw "USDT" tag — rendering `amount` as "USDT" once read
 * as "the wallet loses 50 USDT" on a cash out. Returns null for non-Binance
 * items.
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
 *
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.5 Phase F: an OMT/WHISH system RECEIVE
 * (`omt_system`/`whish_system`, negative cart amount = a payout item) that
 * carries a customer-paid fee-on-top (`formData.includingFees` falsy,
 * `omtFee`/`whishFee` > 0) ALSO contributes that fee into the CHARGE bucket,
 * in the item's own currency — "the fee simply joins the gross charge bucket
 * ... collected by the pooled payment lines" (§1.5). Fee-included
 * (`includingFees` true) contributes nothing extra here: the fee is already
 * netted out of the (smaller) payout amount the item itself carries, so there
 * is nothing separate left to collect. `formData` is optional so callers that
 * never carry a fee (every non-financial module, and existing tests built
 * before this field existed) don't need to supply it.
 */
export function splitBasketCashSides(
  items: Array<
    Pick<CartItem, "module" | "amount" | "currency"> &
      Partial<Pick<CartItem, "formData">>
  >,
): {
  chargeUsd: number;
  chargeLbp: number;
  payoutUsd: number;
  payoutLbp: number;
} {
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

    // A system RECEIVE's fee-on-top rides along as a SEPARATE charge, on top
    // of (never instead of) the payout bucketing above.
    if (
      (item.module === "omt_system" || item.module === "whish_system") &&
      amt < 0
    ) {
      const fd = item.formData ?? {};
      const includingFees = fd.includingFees === true;
      if (!includingFees) {
        const rawFee = item.module === "omt_system" ? fd.omtFee : fd.whishFee;
        const fee = typeof rawFee === "number" && rawFee > 0 ? rawFee : 0;
        if (fee > 0) {
          if (item.currency === "USD") chargeUsd += fee;
          else if (item.currency === "LBP") chargeLbp += fee;
        }
      }
    }
  }
  return { chargeUsd, chargeLbp, payoutUsd, payoutLbp };
}

/**
 * LIRA-270 — the ONE "is there anything left for the customer to pay?" rule
 * for a session basket, shared by the checkout modal (`SessionCheckoutModal`,
 * which hides its payment input and drops its lines when this is true) and
 * `SessionPaymentService.recordBasketPayment` (which refuses a customer-paid
 * leg when this is true). Pure leaf — no Node built-in, reachable from
 * `browser.ts` (rule 29).
 *
 * Both callers pass the net charge AFTER any payout absorbed into it:
 *  - the modal passes `netCashPayoutAgainstCharge`'s remaining charge (a
 *    CASH payout already netted, cross-currency, by the money engine — so
 *    both currencies are ≥ 0 and only the per-currency dust test can fire);
 *  - the server passes `charge − (payout NOT sent as its own leg)`, which can
 *    be negative in one currency and positive in the other when a USD cash
 *    payout was absorbed by an LBP charge (or vice versa). The cross-currency
 *    clause below is that same netting, read from the server's side.
 *
 * What it deliberately does NOT do: decide which payout was absorbed. A
 * payout that left as its own OUT leg never reduced what the customer owes —
 * the caller must not subtract it (the 2026-10-10 regression did, for a
 * gross kind-less leg, and refused a basket whose LBP charge was still due).
 */

/**
 * The payment widget's own dust threshold ($0.01 / 0.5 LBP, `@liratek/ui`
 * money registry): below it in BOTH currencies the payment input is hidden.
 * Deliberately NOT the $0.05 reconcile epsilon, so a few-cent remainder the
 * modal still asks for is never refused.
 */
export const NOTHING_TO_COLLECT_USD = 0.01;
export const NOTHING_TO_COLLECT_LBP = 0.5;
/** Float noise only — far below 0.5 LBP at any real rate. */
const CROSS_CURRENCY_EPSILON_USD = 1e-6;

/**
 * True when there is nothing left to collect: the net charge is below dust
 * in both currencies, or — at a real rate (> 1) — an absorbed payout in one
 * currency cancels the charge in the other (summing to ≤ 0 in USD). A
 * remainder worth less than a cent but more than 0.5 LBP (e.g. 180 LBP) is
 * still owed: the modal asks for it, so this stays false. A rate of 1 is the
 * checkout's missing-rate fallback, so only the per-currency test applies.
 */
export function basketHasNothingToCollect(
  net: { usd: number; lbp: number },
  exchangeRate: number,
): boolean {
  if (net.usd < NOTHING_TO_COLLECT_USD && net.lbp < NOTHING_TO_COLLECT_LBP) {
    return true;
  }
  if (exchangeRate > 1) {
    return net.usd + net.lbp / exchangeRate <= CROSS_CURRENCY_EPSILON_USD;
  }
  return false;
}

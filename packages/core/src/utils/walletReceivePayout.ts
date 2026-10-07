/**
 * LIRA-269 — what a wallet RECEIVE (Binance cash-out, OMT App / Whish App
 * RECEIVE) pays out, in ONE place (rule 14). Pure: no DB, no Node built-ins
 * (safe for `browser.ts`, rule 29). The payout sheets compute their target
 * from it, and FinancialServiceRepository's wallet-RECEIVE branch pays out
 * by it, so the two cannot disagree (rule 22).
 *
 * What a discount means here: it comes off the SHOP'S FEE. The payment
 * sheet caps it at the fee (`maxDiscount = fee`), the app form already
 * booked `commission = fee − discount` (LIRA-185 lead 9), and the owner's
 * MTC/Alfa decision (2026-10-02) is that a discount lowers the profit,
 * capped at the margin. The money that arrived in the wallet is a fact, so
 * a smaller fee means the customer receives MORE. Taking it off the payout
 * instead would leave the drawers up `fee + discount` while the profit
 * stamp says `fee − discount`.
 *
 * Fee modes (the caller folds "fee on top" / "fee deducted" into
 * `walletInflow`, which is what the API receives as `amount`):
 *   - fee on top / deducted: payout = walletInflow − (fee − discount)
 *   - fee collected separately (mode C): payout = walletInflow, and the
 *     customer hands over `fee − discount` through the fee legs.
 */

export interface WalletReceiveInput {
  /** What arrives in the shop's wallet: the API's `amount`. */
  walletInflow: number;
  /** The shop's fee before any discount (the page's `commission` input). */
  fee: number;
  /** The sheet's discount. Clamped to [0, fee]. */
  discount?: number;
  /** Mode C: the customer pays the fee separately, over the counter. */
  feeCollectedSeparately?: boolean;
}

export interface WalletReceiveAmounts {
  /** The discount actually applied (clamped). */
  discount: number;
  /** fee − discount: sent as `commission`, it becomes the profit stamp. */
  commission: number;
  /** What the shop hands the customer (before any kept change). */
  payout: number;
  /** Mode C only: what the fee legs must add up to. 0 otherwise. */
  feeToCollect: number;
}

/** Drops float noise from add-then-subtract (100.37 + 1.0037 − 1.0037 is
 *  100.37000000000001 in IEEE doubles) without touching any real digit:
 *  fees and amounts never carry more than 4 decimals. */
const round6 = (n: number): number => Number(n.toFixed(6));

export function walletReceiveAmounts({
  walletInflow,
  fee,
  discount = 0,
  feeCollectedSeparately = false,
}: WalletReceiveInput): WalletReceiveAmounts {
  const listFee = Math.max(0, Math.abs(fee));
  const applied = Math.min(Math.max(0, discount), listFee);
  const commission = round6(listFee - applied);
  return {
    discount: applied,
    commission,
    payout: feeCollectedSeparately
      ? walletInflow
      : round6(walletInflow - commission),
    feeToCollect: feeCollectedSeparately ? commission : 0,
  };
}

/**
 * LIRA-269 follow-up — what a wallet SEND (Binance SEND, OMT App / Whish App
 * SEND) charges, in ONE place (rule 14). Same meaning as a RECEIVE discount:
 * it comes off the SHOP'S FEE, capped at the fee (owner rule, MTC/Alfa
 * decision 2026-10-02, "Discounts reduce profit"). The wallet still sends
 * the full transfer, so the customer simply pays `fee − discount` less.
 *
 * Used by the sending sheets (their `checkoutTotal` and booked `commission`)
 * and by FinancialServiceRepository's wallet-SEND branch, which refuses a
 * `checkoutTotal` that disagrees with `amount + commission` (rule 22).
 *
 * Note the asymmetry with the sheet: a customer-pays sheet subtracts the
 * discount from the total it is handed, so the sheet's target stays the
 * UNDISCOUNTED `walletOutflow + fee`; `customerPays` is what the legs end up
 * adding to after the sheet takes the discount off.
 */
export interface WalletSendInput {
  /** What leaves the shop's wallet: the API's `amount` (fee modes folded in). */
  walletOutflow: number;
  /** The shop's fee before any discount. */
  fee: number;
  /** The sheet's discount. Clamped to [0, fee]. */
  discount?: number;
}

export interface WalletSendAmounts {
  /** The discount actually applied (clamped). */
  discount: number;
  /** fee − discount: sent as `commission`, it becomes the profit stamp. */
  commission: number;
  /** walletOutflow + commission: what the customer pays (`checkoutTotal`). */
  customerPays: number;
}

export function walletSendAmounts({
  walletOutflow,
  fee,
  discount = 0,
}: WalletSendInput): WalletSendAmounts {
  const listFee = Math.max(0, Math.abs(fee));
  const applied = Math.min(Math.max(0, discount), listFee);
  const commission = round6(listFee - applied);
  return {
    discount: applied,
    commission,
    customerPays: round6(Math.abs(walletOutflow) + commission),
  };
}

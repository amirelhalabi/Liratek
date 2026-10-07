import { walletReceiveAmounts, walletSendAmounts } from "@liratek/core";

/**
 * Binance (crypto) SEND / cash-out amounts, in ONE place for the form's
 * payment sheet and the page's submit payload (LIRA-269 — they were two
 * hand-kept copies of the same fee-mode math).
 *
 * feeIncluded: the entered amount already contains the shop fee.
 *   SEND:    feeIncluded → USDT out = amount − fee, customer pays amount
 *           !feeIncluded → USDT out = amount,       customer pays amount + fee
 *   RECEIVE: feeIncluded → USDT in  = amount,       payout = amount − fee
 *           !feeIncluded → USDT in  = amount + fee, payout = amount
 * RECEIVE mode C (feeCollectedSeparately): USDT in = amount, payout = amount,
 * the fee is collected over the counter instead (never applies to SEND).
 *
 * RECEIVE payout, booked fee and fee-to-collect come from
 * `walletReceiveAmounts` — the helper FinancialServiceRepository pays out by.
 * A cash-out discount comes off the shop's fee, so the customer receives
 * that much more (or, in mode C, that much less fee is collected).
 *
 * SEND (LIRA-269 follow-up): the same meaning — the discount comes off the
 * shop's fee, so the customer pays that much less and `commission` is
 * `fee − discount`, from `walletSendAmounts` (the helper the server checks
 * `checkoutTotal` against). The sheet's target stays `sendTotal` (before the
 * discount — a customer-pays sheet subtracts it itself); `sendCustomerPays`
 * is what the legs add up to afterwards.
 */
export interface CryptoAmountsInput {
  cryptoType: "SEND" | "RECEIVE";
  parsedAmount: number;
  fee: number;
  feeIncluded: boolean;
  feeCollectedSeparately: boolean;
  /** The sheet's discount, off the shop's fee (both directions). Default 0. */
  discount?: number;
}

export interface CryptoAmounts {
  sendUsdt: number;
  /** SEND: the sheet's target, before the discount. */
  sendTotal: number;
  /** SEND: what the customer pays after the discount (`checkoutTotal`). */
  sendCustomerPays: number;
  receiveUsdt: number;
  /** RECEIVE: what the shop hands the customer (the sheet's target). */
  payout: number;
  /** RECEIVE mode C: what the separately-paid fee legs add up to. */
  feeToCollect: number;
  /** The API's `amount`: the USDT that moves (SEND out / RECEIVE in). */
  apiAmount: number;
  /** The API's `commission`: the fee after the discount, both directions. */
  commission: number;
}

export function cryptoAmounts({
  cryptoType,
  parsedAmount,
  fee,
  feeIncluded,
  feeCollectedSeparately,
  discount = 0,
}: CryptoAmountsInput): CryptoAmounts {
  const sendUsdt = feeIncluded ? parsedAmount - fee : parsedAmount;
  const sendTotal = feeIncluded ? parsedAmount : parsedAmount + fee;
  const receiveUsdt =
    feeIncluded || feeCollectedSeparately ? parsedAmount : parsedAmount + fee;
  const receive = walletReceiveAmounts({
    walletInflow: receiveUsdt,
    fee,
    discount: cryptoType === "RECEIVE" ? discount : 0,
    feeCollectedSeparately,
  });
  const send = walletSendAmounts({
    walletOutflow: sendUsdt,
    fee,
    discount: cryptoType === "SEND" ? discount : 0,
  });
  return {
    sendUsdt,
    sendTotal,
    sendCustomerPays: send.customerPays,
    receiveUsdt,
    payout: receive.payout,
    feeToCollect: receive.feeToCollect,
    apiAmount: cryptoType === "RECEIVE" ? receiveUsdt : sendUsdt,
    commission: cryptoType === "RECEIVE" ? receive.commission : send.commission,
  };
}

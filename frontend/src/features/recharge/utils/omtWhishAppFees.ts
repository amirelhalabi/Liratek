import { walletReceiveAmounts, walletSendAmounts } from "@liratek/core";

export interface OmtWhishAppFeeInputs {
  activeProvider: "OMT_APP" | "WHISH_APP";
  serviceType: "SEND" | "RECEIVE";
  currency: "USD" | "LBP";
  parsedAmount: number;
  /** Raw fee input state. "" means the field hasn't been touched — fall back
   *  to the auto-fee. Any other string (including "0") is an explicit user
   *  value and overrides the auto-fee, including to zero. */
  manualFee: string;
  /** Whether the entered amount already nets out the fee. Ignored for SEND
   *  (the form only offers it on a RECEIVE, but its state survives a switch
   *  to SEND — honouring it there sent `amount − fee` while charging
   *  `amount + fee`).
   *  The "Fee included in amount" checkbox only renders for Whish App, so
   *  OMT App RECEIVE always resolves this to its default `false` — the fee
   *  is always charged on top of the entered amount for OMT App today. */
  includingFees: boolean;
  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase D (owner decision Q7,
   * 2026-08-06): mode C — "customer pays separately". RECEIVE only, both
   * OMT App and Whish App. When true, the fee touches NEITHER the wallet
   * inflow nor the cash payout: the wallet receives the BARE entered
   * amount and the customer receives the FULL entered amount, and the fee
   * is instead collected via a separate `feePayments[]` leg set (a
   * counter-flow section in the PaymentSheet). Mutually exclusive with
   * `includingFees` (mode B, "deducted from payout") — callers must never
   * set both; when both are true this takes precedence for RECEIVE (mode C
   * wins) since the caller-side UI already prevents selecting more than one
   * mode at a time. Ignored for SEND. Default false/omitted — every
   * existing caller (modes A/B) computes byte-identical wallet/total
   * amounts to before this field existed.
   */
  feeCollectedSeparately?: boolean;
  /**
   * LIRA-269: the payment sheet's discount (already capped at the fee by the
   * sheet; capped again here). It comes off the shop's fee: SEND charges the
   * customer that much less (the sheet subtracts it from `totalAmount`
   * itself; `customerPays` is the result, from `walletSendAmounts`); RECEIVE
   * pays the customer that much MORE — `totalAmount` below already includes
   * it, because a payout sheet never subtracts a discount (MultiPaymentInput,
   * `payer="payout"`). Default 0.
   */
  discount?: number;
}

export interface OmtWhishAppFeeResult {
  autoFee: number;
  providerFee: number;
  /** True for RECEIVE on either app-wallet provider (OMT App or Whish App) —
   *  structurally both still split wallet-inflow vs. cash-payout the same way
   *  (LEFT_TO_DO.md "C4/C5 app-transfer fee split", decided 2026-07-04). D1
   *  (2026-09-23) narrows the FEE side only: OMT App RECEIVE's providerFee/
   *  shopProfit are now forced to 0 above, so wallet-inflow and cash-payout
   *  collapse to the same bare entered amount for it — this flag itself is
   *  unaffected and stays true for both providers on RECEIVE. */
  isAppWalletReceive: boolean;
  /** The amount sent to the API as `data.amount` — for an app-wallet RECEIVE
   *  this is the GROSS wallet inflow, not the cash the customer receives. */
  walletAmount: number;
  /** SEND: the sheet's target — amount + fee BEFORE the discount (the
   *  sheet takes the discount off itself; see `customerPays`).
   *  App-wallet RECEIVE (OMT App or Whish App): the cash payout the customer
   *  actually receives. */
  totalAmount: number;
  /** The shop keeps the ENTIRE fee as profit on BOTH directions (0 if no fee
   *  is set). Sent to the API as `commission`; for SEND the repository also
   *  derives the customer's cash-in / on-account total from it
   *  (amount + commission) — a 0 here silently dropped the fee from the
   *  drawer, debt, and profit records. */
  shopProfit: number;
  /** LIRA-269: what is booked as `commission` — the fee after the discount.
   *  RECEIVE: from `walletReceiveAmounts`, the helper the server pays out by. */
  commission: number;
  /** Mode C RECEIVE only: what the separately-paid fee legs must add up to
   *  (fee − discount). 0 otherwise. */
  feeToCollect: number;
  /** SEND only: what the customer pays after the discount — `amount +
   *  commission`, from `walletSendAmounts`, the helper the server checks
   *  `checkoutTotal` against. 0 for a RECEIVE. */
  customerPays: number;
}

/**
 * Fee/amount math shared by the OMT App / Whish App transfer form and its
 * session-cart path. Kept as a pure function so the app-wallet RECEIVE
 * contract (wallet inflow vs. cash payout, full-fee profit) can be unit
 * tested without rendering the form.
 */
export function calculateOmtWhishAppFees({
  activeProvider,
  serviceType,
  currency,
  parsedAmount,
  manualFee,
  includingFees,
  feeCollectedSeparately = false,
  discount = 0,
}: OmtWhishAppFeeInputs): OmtWhishAppFeeResult {
  // D1 (owner decision, 2026-09-23, supersedes the lira-101 "mirrors Whish
  // App" contract for this one combination): OMT App RECEIVE has no fee at
  // all, for now. SEND is unaffected on both providers, and Whish App
  // RECEIVE keeps its existing full-fee-as-profit model unchanged. Forced
  // here — the single place this math lives (rule 14) — rather than relying
  // on the form to simply not render the fee input, so a stale `manualFee`
  // left over from switching away from OMT App SEND (or from Whish App
  // RECEIVE) can never leak into the wallet/payout/profit figures.
  const omtAppReceiveHasNoFee =
    activeProvider === "OMT_APP" && serviceType === "RECEIVE";
  // Production testing 2026-10-07: Whish App SEND has no fee either — the
  // form never offers a fee input for it (the Fee Breakdown is hidden), but a
  // fee typed on Whish App RECEIVE survived the switch to SEND and was
  // charged to the customer and booked as commission. Forced here for the
  // same reason as OMT App RECEIVE above.
  const whishAppSendHasNoFee =
    activeProvider === "WHISH_APP" && serviceType === "SEND";
  // Whish App LBP RECEIVE has no fee either — the form hides the fee field
  // there, but a fee typed while the toggle was on USD survived the switch
  // to LBP and was charged and booked without the cashier seeing it.
  const whishAppLbpReceiveHasNoFee =
    activeProvider === "WHISH_APP" &&
    serviceType === "RECEIVE" &&
    currency === "LBP";
  const hasNoFee =
    omtAppReceiveHasNoFee || whishAppSendHasNoFee || whishAppLbpReceiveHasNoFee;

  const autoFee =
    !hasNoFee &&
    activeProvider === "WHISH_APP" &&
    serviceType === "RECEIVE" &&
    currency === "USD" &&
    parsedAmount > 0
      ? parsedAmount * 0.01
      : 0;
  const providerFee = hasNoFee
    ? 0
    : manualFee !== ""
      ? parseFloat(manualFee) || 0
      : autoFee;

  const isAppWalletReceive = serviceType === "RECEIVE"; // both OMT_APP and WHISH_APP reach this form

  // Mode C (RECEIVE only): the fee never touches the wallet inflow or the
  // cash payout — both collapse to the bare entered amount, exactly like the
  // "no fee" case, because the fee is realized entirely through the separate
  // feePayments counter-flow instead of the wallet-vs-payout spread modes
  // A/B use.
  const walletAmount =
    serviceType === "SEND"
      ? parsedAmount
      : feeCollectedSeparately
        ? parsedAmount
        : includingFees
          ? parsedAmount
          : parsedAmount + providerFee;

  // SEND and RECEIVE alike: the fee is charged to the customer on top of the
  // transfer and kept whole by the shop (LEFT_TO_DO.md 2026-07-04 decision).
  const shopProfit = providerFee;

  // RECEIVE (LIRA-269): payout, booked fee and fee-to-collect come from the
  // ONE helper the repository's wallet-RECEIVE branch pays out by, fed the
  // wallet inflow above (mode A: amount + fee; B: amount; C: amount). With
  // no discount this is exactly amount / amount − fee / amount as before.
  const receive =
    serviceType === "RECEIVE"
      ? walletReceiveAmounts({
          walletInflow: walletAmount,
          fee: providerFee,
          discount,
          feeCollectedSeparately,
        })
      : null;

  // SEND (LIRA-269 follow-up): the ONE helper the repository's wallet-SEND
  // branch checks `checkoutTotal` against. The sheet's target stays the
  // undiscounted amount + fee — it subtracts the discount itself.
  const send =
    serviceType === "SEND"
      ? walletSendAmounts({
          walletOutflow: walletAmount,
          fee: providerFee,
          discount,
        })
      : null;

  const totalAmount = receive
    ? receive.payout
    : walletAmount + providerFee;
  const commission = receive
    ? receive.commission
    : (send?.commission ?? 0);

  return {
    autoFee,
    providerFee,
    isAppWalletReceive,
    walletAmount,
    totalAmount,
    shopProfit,
    commission,
    feeToCollect: receive?.feeToCollect ?? 0,
    customerPays: send?.customerPays ?? 0,
  };
}

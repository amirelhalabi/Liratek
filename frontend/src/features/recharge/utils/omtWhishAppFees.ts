export interface OmtWhishAppFeeInputs {
  activeProvider: "OMT_APP" | "WHISH_APP";
  serviceType: "SEND" | "RECEIVE";
  currency: "USD" | "LBP";
  parsedAmount: number;
  /** Raw fee input state. "" means the field hasn't been touched — fall back
   *  to the auto-fee. Any other string (including "0") is an explicit user
   *  value and overrides the auto-fee, including to zero. */
  manualFee: string;
  /** Whether the entered amount already nets out the fee. Ignored for SEND.
   *  The "Fee included in amount" checkbox only renders for Whish App, so
   *  OMT App RECEIVE always resolves this to its default `false` — the fee
   *  is always charged on top of the entered amount for OMT App today. */
  includingFees: boolean;
}

export interface OmtWhishAppFeeResult {
  autoFee: number;
  providerFee: number;
  /** True for RECEIVE on either app-wallet provider (OMT App or Whish App) —
   *  both keep the ENTIRE fee as profit and split wallet-inflow vs. cash-payout
   *  the same way (LEFT_TO_DO.md "C4/C5 app-transfer fee split", decided
   *  2026-07-04: the fee is fully the shop's for both providers). */
  isAppWalletReceive: boolean;
  /** The amount sent to the API as `data.amount` — for an app-wallet RECEIVE
   *  this is the GROSS wallet inflow, not the cash the customer receives. */
  walletAmount: number;
  /** SEND: the customer's total cash payment (amount + fee).
   *  App-wallet RECEIVE (OMT App or Whish App): the cash payout the customer
   *  actually receives. */
  totalAmount: number;
  /** The shop keeps the ENTIRE fee as profit on BOTH directions (0 if no fee
   *  is set). Sent to the API as `commission`; for SEND the repository also
   *  derives the customer's cash-in / on-account total from it
   *  (amount + commission) — a 0 here silently dropped the fee from the
   *  drawer, debt, and profit records. */
  shopProfit: number;
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
}: OmtWhishAppFeeInputs): OmtWhishAppFeeResult {
  const autoFee =
    activeProvider === "WHISH_APP" &&
    serviceType === "RECEIVE" &&
    currency === "USD" &&
    parsedAmount > 0
      ? parsedAmount * 0.01
      : 0;
  const providerFee = manualFee !== "" ? parseFloat(manualFee) || 0 : autoFee;

  const isAppWalletReceive = serviceType === "RECEIVE"; // both OMT_APP and WHISH_APP reach this form

  const walletAmount =
    serviceType === "SEND"
      ? includingFees
        ? parsedAmount - providerFee
        : parsedAmount
      : includingFees
        ? parsedAmount
        : parsedAmount + providerFee;

  const totalAmount =
    serviceType === "SEND"
      ? parsedAmount + providerFee
      : includingFees
        ? parsedAmount - providerFee
        : parsedAmount;

  // SEND and RECEIVE alike: the fee is charged to the customer on top of the
  // transfer and kept whole by the shop (LEFT_TO_DO.md 2026-07-04 decision).
  const shopProfit = providerFee;

  return {
    autoFee,
    providerFee,
    isAppWalletReceive,
    walletAmount,
    totalAmount,
    shopProfit,
  };
}

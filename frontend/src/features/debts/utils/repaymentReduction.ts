/**
 * computeRepaymentReduction
 *
 * How much of a client's debt a repayment clears, PER CURRENCY.
 *
 * The debt is reduced by the NET the customer actually paid — gross tendered
 * MINUS any change handed back (the OUT "return" legs), per currency. Netting
 * is what stops an overpayment being counted twice: without it, a customer who
 * hands over more than the debt (e.g. round LBP notes) has the excess BOTH
 * returned as change AND cleared from the debt, over-reducing it into a phantom
 * store credit and quietly draining the drawer. Change can come back in either
 * currency, so both are netted.
 *
 * USD paid settles USD debt, LBP paid settles LBP debt; only the cross-currency
 * remainder converts at `rate`, keeping the documented smart-rounding (paying
 * the rounded fractional part clears the exact fractional debt).
 */
export interface RepaymentReductionInput {
  /** Gross amount tendered by the customer, per currency (IN legs). */
  paidUsd: number;
  paidLbp: number;
  /** Change handed back to the customer, per currency (OUT/return legs). */
  returnedUsd: number;
  returnedLbp: number;
  /** Outstanding debt, per currency. */
  dueUsd: number;
  dueLbp: number;
  /** USD→LBP rate the modal used (buy rate for repayments). */
  rate: number;
}

export function computeRepaymentReduction({
  paidUsd,
  paidLbp,
  returnedUsd,
  returnedLbp,
  dueUsd,
  dueLbp,
  rate,
}: RepaymentReductionInput): { reduceUsd: number; reduceLbp: number } {
  // Net the change back out first — this is the whole point (see file header).
  const netPaidUsd = Math.max(0, paidUsd - returnedUsd);
  const netPaidLbp = Math.max(0, paidLbp - returnedLbp);

  let reduceUsd = Math.min(netPaidUsd, dueUsd);
  let reduceLbp = Math.min(netPaidLbp, dueLbp);
  const leftoverUsd = netPaidUsd - reduceUsd;
  const leftoverLbp = netPaidLbp - reduceLbp;

  if (leftoverLbp > 0) {
    // LBP remainder against the remaining USD debt — smart rounding: paying
    // the rounded fractional part clears the exact fraction (see README).
    const remUsdDue = dueUsd - reduceUsd;
    const fractionalDebt = remUsdDue - Math.floor(remUsdDue);
    const roundedFractionalLBP =
      Math.ceil((fractionalDebt * rate) / 5000) * 5000;
    if (Math.abs(leftoverLbp - roundedFractionalLBP) < 1000) {
      reduceUsd += fractionalDebt;
    } else {
      reduceUsd += leftoverLbp / rate;
    }
  }
  if (leftoverUsd > 0) {
    // USD remainder settles remaining LBP debt; anything beyond that stays as
    // USD over-reduction (customer credit), matching overpay behaviour.
    const remLbpDue = dueLbp - reduceLbp;
    const asLbp = leftoverUsd * rate;
    const toLbp = Math.min(asLbp, remLbpDue);
    reduceLbp += toLbp;
    reduceUsd += (asLbp - toLbp) / rate;
  }

  return { reduceUsd, reduceLbp };
}

/**
 * applyDebtDiscount
 *
 * CQ-10: a bundled repayment can forgive part of the debt alongside the cash
 * payment (owed − paid − discount = remaining). This clamps the requested
 * discount, per currency, to what is actually owed (forgiving more than the
 * debt doesn't make sense) and returns the REMAINING due after the discount.
 *
 * Callers MUST feed `remainingDueUsd/remainingDueLbp` — not the raw
 * `dueUsd/dueLbp` — into BOTH the MultiPaymentInput `totals` prop (so the
 * operator sees the discounted total live) AND `computeRepaymentReduction`'s
 * `dueUsd/dueLbp` at submit time. Passing the raw due into the reduction call
 * would only happen to stay correct by relying on change-leg netting to cap
 * the effective payment — capping the DUE itself makes
 * `paid + appliedDiscount ≤ dueUsd/dueLbp` hold structurally, independent of
 * how change is handled.
 */
export interface ApplyDebtDiscountInput {
  dueUsd: number;
  dueLbp: number;
  discountUsd: number;
  discountLbp: number;
}

export interface ApplyDebtDiscountResult {
  /** Discount actually applied, per currency — capped at what's due. */
  appliedDiscountUsd: number;
  appliedDiscountLbp: number;
  /** Due AFTER the discount, per currency — feed this to both the payment
   *  UI's totals and the reduction math, never the raw due. */
  remainingDueUsd: number;
  remainingDueLbp: number;
}

export function applyDebtDiscount({
  dueUsd,
  dueLbp,
  discountUsd,
  discountLbp,
}: ApplyDebtDiscountInput): ApplyDebtDiscountResult {
  const appliedDiscountUsd = Math.min(
    Math.max(0, discountUsd),
    Math.max(0, dueUsd),
  );
  const appliedDiscountLbp = Math.min(
    Math.max(0, discountLbp),
    Math.max(0, dueLbp),
  );
  return {
    appliedDiscountUsd,
    appliedDiscountLbp,
    remainingDueUsd: Math.max(0, dueUsd - appliedDiscountUsd),
    remainingDueLbp: Math.max(0, dueLbp - appliedDiscountLbp),
  };
}

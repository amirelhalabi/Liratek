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
 * store credit and quietly draining the drawer. Change can come back in EITHER
 * currency regardless of which currency it was tendered in (e.g. paid all-USD,
 * change given in LBP), so a currency's net is allowed to go negative and is
 * then settled against the other currency at `rate` before either side is
 * clamped at 0 — both are netted, cross-currency included.
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

/**
 * KeptChangeReport
 *
 * What MultiPaymentInput's `onKeptChange` reports when keep-change (T3) is
 * on. `usd`/`lbp` are ROUNDED to each currency's display precision (USD
 * cents, LBP whole units) — correct for showing "$0.06 kept" in the UI.
 * `exactUsd`/`exactLbp` carry the UNROUNDED excess `allocatePayments`
 * actually computed.
 */
export interface KeptChangeReport {
  usd: number;
  lbp: number;
  exactUsd?: number;
  exactLbp?: number;
}

/**
 * resolveKeptChangeForReduction
 *
 * Which figure a debt reduction NETS OUT of the customer's tender (see
 * computeRepaymentReduction's header) must be the EXACT kept amount, never
 * the currency-rounded DISPLAY figure `usd`/`lbp`. Keep-change with T3 on
 * never crosses a drawer boundary — nothing is physically handed back — so
 * there is no reason to round it to a "handable" denomination first, and
 * doing so before converting the remainder at the day's rate manufactures a
 * residual: owner note #8 (2026-09-23) — a $0.06-vs-$0.0561... rounding on
 * a kept-change repayment left a client's debt short by 340 LBP after a
 * payment that should have cleared it exactly (see
 * repaymentReduction.keptChangeComposition.test.ts for the failing-first
 * proof against the pre-fix rounded-only version of this function).
 *
 * Falls back to the rounded figure when the exact one is unavailable
 * (defensive — e.g. an older/mocked caller that only ever set `usd`/`lbp`).
 */
export function resolveKeptChangeForReduction(
  kept: KeptChangeReport | null,
): { usd: number; lbp: number } {
  if (!kept) return { usd: 0, lbp: 0 };
  return {
    usd: kept.exactUsd ?? kept.usd,
    lbp: kept.exactLbp ?? kept.lbp,
  };
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
  // A same-currency net is allowed to go negative here: that means more was
  // returned in that currency than was tendered in it, i.e. the change came
  // from the OTHER currency's payment. Settle that deficit against the other
  // currency's net at `rate` before either side is clamped at 0.
  let netUsd = paidUsd - returnedUsd;
  let netLbp = paidLbp - returnedLbp;
  if (netUsd < 0) {
    netLbp += netUsd * rate;
    netUsd = 0;
  }
  if (netLbp < 0) {
    netUsd += netLbp / rate;
    netLbp = 0;
  }
  const netPaidUsd = Math.max(0, netUsd);
  const netPaidLbp = Math.max(0, netLbp);

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

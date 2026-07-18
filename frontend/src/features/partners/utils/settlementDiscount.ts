/**
 * capSettlementDiscount
 *
 * CQ-10 — a partner settlement can bundle a forgiven remainder alongside the
 * cash settled ("owed X, paid Y, discount Z"). `PartnerService.settle` posts
 * the settlement `amount` and the `discount` as two INDEPENDENT
 * partner_ledger rows with NO combined server-side validation — it doesn't
 * even cap the settlement `amount` alone against the balance. Without a
 * client-side cap, an operator could settle Y=100 + discount Z=30 against a
 * balance of only X=100, posting 130 of reduction against a 100 receivable —
 * the same phantom-over-reduction class the Debts repayment discount seam
 * (`applyDebtDiscount`) guards against.
 *
 * This caps the discount at what's left AFTER the settlement amount, in the
 * SAME currency (partner_ledger is one-row-per-currency, so both the
 * settlement and its bundled discount always share one currency — unlike
 * Debts, which can mix USD+LBP due in one repayment).
 */
export function capSettlementDiscount(
  balanceInCurrency: number,
  settlementAmount: number,
  requestedDiscount: number,
): number {
  const maxDiscount = Math.max(
    0,
    Math.max(0, balanceInCurrency) - Math.max(0, settlementAmount),
  );
  return Math.min(Math.max(0, requestedDiscount), maxDiscount);
}

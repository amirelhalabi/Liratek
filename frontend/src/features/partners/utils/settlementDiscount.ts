/**
 * Room left to discount, in the same currency, AFTER the settlement amount
 * is taken out of the balance. Shared by `capSettlementDiscount` (the
 * authoritative cap) and the SettleModal's "Up to $X" / clipped-discount
 * hint, so the two never drift apart (rule 14 — don't copy-paste a
 * business-rule predicate into a second call site).
 */
export function discountRoomAfterSettlement(
  balanceInCurrency: number,
  settlementAmount: number,
): number {
  return Math.max(
    0,
    Math.max(0, balanceInCurrency) - Math.max(0, settlementAmount),
  );
}

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
  const maxDiscount = discountRoomAfterSettlement(
    balanceInCurrency,
    settlementAmount,
  );
  return Math.min(Math.max(0, requestedDiscount), maxDiscount);
}

/**
 * True when the operator's raw discount input would be clipped (partly or
 * entirely) by `capSettlementDiscount` because the settlement leg still
 * claims all — or more than all — the room left in the balance.
 *
 * Drives the SettleModal's "lower the payment amount" hint. Without it, the
 * discount field silently rubber-bands back to a smaller (often $0.00)
 * number with no explanation — MultiPaymentInput auto-fills the settlement
 * leg to the FULL balance by default, so a discount typed before the
 * operator manually shrinks that leg has zero room and gets capped to 0,
 * which reads as a broken/unresponsive input rather than an over-the-cap
 * discount (owner-reported UX confusion, COUNTERPARTY_CONSOLIDATION_PLAN).
 */
export function isDiscountClippedBySettlement(
  balanceInCurrency: number,
  settlementAmount: number,
  requestedDiscount: number,
): boolean {
  const room = discountRoomAfterSettlement(balanceInCurrency, settlementAmount);
  return Math.max(0, requestedDiscount) > room;
}

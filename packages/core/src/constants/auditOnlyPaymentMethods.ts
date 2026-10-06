/**
 * Payment methods whose `payments` rows are AUDIT-ONLY: the writer inserts
 * the row for reporting but applies NO drawer delta, because the money is
 * already inside another leg of the same transaction (LIRA-258, gap G34).
 *
 *   - PM_FEE — the payment-method fee on an OMT/WHISH system SEND
 *     (FinancialServiceRepository). The wallet leg is credited in full,
 *     fee included; the PM_FEE row only labels the fee portion.
 *
 * Any reversal that mirrors these rows must keep the mirror row (so the
 * journal nets to zero) but must NOT apply a drawer delta for it — otherwise
 * it takes back money that was never added on its own.
 *
 * Deliberately NOT here: COMMISSION. Its wallet/Binance rows carry amount 0
 * (a reversal delta of 0 is harmless), but its non-OMT/WHISH rows DO move
 * the drawer, so skipping it by method would break those voids.
 *
 * Pure leaf module (rule 29): no imports.
 */
export const AUDIT_ONLY_PAYMENT_METHODS: ReadonlySet<string> = new Set([
  "PM_FEE",
]);

export function isAuditOnlyPaymentMethod(method: string): boolean {
  return AUDIT_ONLY_PAYMENT_METHODS.has(method);
}

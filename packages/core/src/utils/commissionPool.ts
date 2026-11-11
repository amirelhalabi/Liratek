/**
 * LIRA-384 (owner 2026-11-11) — the ONE rule for which transfers carry a
 * settlement commission entered in one currency, shared by the batch Settle
 * (`SupplierRepository._bookCommissionAtSettlement`), the account sheet
 * (`SupplierRepository._settleAccountAmountFirst`) and its preview
 * (`AccountSettleSheet.tsx`) — rule 14.
 *
 * - The currency's OWN eligible transfers when it has any (each path keeps
 *   its own weighting over them).
 * - Otherwise EVERY eligible transfer of the settlement, split equally
 *   (`spread: true`): amounts in another currency are not comparable
 *   weights. This is a real flow — Katsh bills are booked in USD and paid
 *   commission in LBP — and before this rule the commission landed on no
 *   row, so Profits (which reads `settlement_commission_allocations`)
 *   never saw it.
 *
 * An empty result means there is no transfer at all to carry it; callers
 * refuse that. Pure leaf: reachable from `browser.ts` (rule 29).
 */
export function commissionPool<T>(
  own: readonly T[],
  all: readonly T[],
): { rows: T[]; spread: boolean } {
  if (own.length > 0) return { rows: [...own], spread: false };
  return { rows: [...all], spread: all.length > 0 };
}

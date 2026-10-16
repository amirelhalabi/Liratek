/**
 * LIRA-327 — the question asked when For Partner is turned on while the
 * Mobile Recharge basket already holds items: turning it on makes ALL of
 * them (every tab's cards and bills) one partner order.
 */
export function partnerConfirmMessage(count: number): string {
  return count === 1
    ? "Make the item in the basket a partner order?"
    : `Make all ${count} items in the basket a partner order?`;
}

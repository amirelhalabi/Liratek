/**
 * The ONE rule for "does the walk-in customer of a session basket pay (or get
 * paid) for this cart item?" when the item is a For-Partner (FOR) transaction —
 * shared by the session checkout modal (`splitBasketCashSides`, the basket's
 * `SessionContext`) and the server (`SessionCheckoutService`) so the two can
 * never disagree about what the customer owes (rule 14).
 *
 * A FOR item is done for a partner's customer, not for the walk-in in front of
 * the counter: the item books the partner's obligation itself (FEATURE_GUIDE
 * §8.1.0 — e.g. a FOR-partner OMT/WHISH SEND: the provider is owed x + f, the
 * partner owes the shop x + f, no drawer moves). Its cart `amount` must
 * therefore contribute NOTHING to the basket's customer charge or payout —
 * otherwise the same transfer is charged to the walk-in AND to the partner.
 *
 * A `_batch` item counts as FOR only when every sub-item is FOR (no screen
 * produces a mixed batch; a mixed one keeps its amount rather than guessing a
 * split).
 *
 * Browser-safe leaf (rule 29): reachable from `browser.ts`, imports nothing.
 */

/** True when one financial/service payload is a For-Partner transaction. */
export function isForPartnerPayload(
  formData: Record<string, unknown> | null | undefined,
): boolean {
  return !!formData && formData.partnerMode === "FOR";
}

/** True when a whole cart item (top-level payload or `_batch`) is FOR. */
export function isForPartnerBasketItem(
  formData: Record<string, unknown> | null | undefined,
): boolean {
  if (!formData) return false;
  if (formData._batch === true && Array.isArray(formData.items)) {
    const items = formData.items as Array<Record<string, unknown>>;
    return items.length > 0 && items.every((sub) => isForPartnerPayload(sub));
  }
  return isForPartnerPayload(formData);
}

/** The signed amount the walk-in customer pays (+) or is paid (−) for this
 *  cart item: its own `amount`, or 0 for a For-Partner item. */
export function sessionBasketCustomerAmount(item: {
  amount: number;
  formData?: Record<string, unknown> | null | undefined;
}): number {
  return isForPartnerBasketItem(item.formData) ? 0 : item.amount;
}

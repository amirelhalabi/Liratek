/**
 * LIRA-271 — the ONE rule for "does the pooled session-basket payment collect
 * this RECEIVE's fee on top?", shared by the session checkout modal
 * (`splitBasketCashSides`, frontend) and the server
 * (`SessionCheckoutService` → `getSessionCashSplitContext`) so they can never
 * disagree about what the customer owes (rule 14). Before this, the modal
 * counted an OMT RECEIVE's informational `omtFee` and ignored batch
 * sub-items while the server did the opposite — a gap the kept-change check
 * (G42) turned into a refused honest checkout.
 *
 * The rule (FEATURE_GUIDE §8.1 / D1, OWNER_NOTES_2026-09-21 §2b):
 *  - WHISH system RECEIVE, fee on top (`includingFees !== true`), operator
 *    entered a fee → YES. The fee is the shop's profit, collected from the
 *    customer at the counter; in a basket that means the pooled payment.
 *  - OMT system RECEIVE → NO. OMT never takes a fee from the customer on
 *    RECEIVE; `omtFee` only drives the commission calculation.
 *  - App-wallet RECEIVE (OMT_APP / WHISH_APP) → NO. Its fee rides in the
 *    wallet inflow (wallet gets amount + fee, the customer is paid the bare
 *    amount — `calculateOmtWhishAppFees`), never over the counter.
 *  - Fee included (`includingFees === true`) → NO. It is already netted out
 *    of the smaller payout the item carries.
 *  - For-Partner (`partnerMode: "FOR"`) → NO. There is no walk-in customer
 *    (`sessionForPartnerItem.ts`).
 *  - Anything else (SEND, BILL, non-financial items) → NO.
 *
 * The VALUE is the item's own `whishFee`, in the item's own currency. The
 * server stores exactly that value for a WHISH RECEIVE (no tier fallback on
 * RECEIVE) and reads it back from `financial_services.whish_fee`, so both
 * sides add the same number.
 *
 * Browser-safe leaf (rule 29): reachable from `browser.ts`; imports only the
 * pure `sessionForPartnerItem.ts` leaf.
 */

import { isForPartnerPayload } from "./sessionForPartnerItem.js";

/** The fee the pooled basket payment collects for this item's formData
 *  (one financial-service payload — a top-level item or one batch
 *  sub-item), in that payload's own currency. 0 when none. */
export function sessionPooledReceiveFee(
  formData: Record<string, unknown> | null | undefined,
): number {
  if (!formData) return 0;
  // A For-Partner RECEIVE has no walk-in customer: its fee is the partner's
  // business, never collected by the session's pooled payment.
  if (isForPartnerPayload(formData)) return 0;
  if (formData.provider !== "WHISH") return 0;
  if (formData.serviceType !== "RECEIVE") return 0;
  if (formData.includingFees === true) return 0;
  const fee = formData.whishFee;
  return typeof fee === "number" && Number.isFinite(fee) && fee > 0 ? fee : 0;
}

/** True when the pooled basket payment collects this payload's fee. */
export function isSessionPooledFeeReceive(
  formData: Record<string, unknown> | null | undefined,
): boolean {
  return sessionPooledReceiveFee(formData) > 0;
}

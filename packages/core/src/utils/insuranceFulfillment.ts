/**
 * Custom-service fulfilment status model — the ONE definition (rule 14).
 *
 * LIRA-155 tracks the physical lifecycle of an insurance-style custom
 * service — the shop sells a policy the customer will not walk out the door
 * with, and needs a single source of truth for where the paperwork
 * currently sits. `custom_services.fulfillment_status` (migration v158)
 * moves through four real-world events, in this order and no other
 * (owner decision D4.2, 2026-08-29):
 *
 *   ORDERED   -> placed with the partner/insurer, nothing exists yet
 *   ISSUED    -> the policy exists, but it is still with the partner
 *   RECEIVED  -> the physical document is now in the shop
 *   DELIVERED -> handed to the customer                         [terminal]
 *
 * There is deliberately NO 'CANCELLED' value (owner decision D4.2b). Cancel
 * and Refund are ONE operation with two doors: the insurance page's Cancel
 * button runs the SAME generic refund path the Transactions table uses, and
 * "Cancelled" is a label the UI DERIVES from `custom_services.is_refunded`
 * (already stamped by `TransactionRepository._markSourceRefunded`'s
 * `custom_services` whitelist entry) — never a status value stored here. A
 * stored CANCELLED beside `is_refunded` would just be the same fact recorded
 * in two columns, which is exactly what deriving it avoids: the two pages
 * can never disagree, because there is only one fact.
 *
 * TRANSITION RULE (owner decision D4.2, this ticket) — STRICT, forward-only,
 * one step at a time. No skipping (e.g. ORDERED -> RECEIVED) and no going
 * backward (e.g. RECEIVED -> ISSUED). Reasoning, for the doc comment the
 * ticket asked for:
 *   - Each step names a real, physical event that must actually have
 *     happened before the next one is even possible: the shop cannot hand a
 *     document to a customer (DELIVERED) that was never physically received
 *     (RECEIVED), and "received" implies "issued" already happened somewhere
 *     upstream. Skipping a step would assert a physical event that provably
 *     did not happen — the same reason a POS sale cannot decrement stock it
 *     never received.
 *   - Going backward would un-happen a past physical event (the document WAS
 *     received; an operator's later mistake elsewhere doesn't make that stop
 *     being true). Every other reversal in this codebase is additive-only
 *     (rule 20 — void/refund books a NEW compensating row, it never deletes
 *     or rewinds one), and this status is no different: a mis-click is
 *     corrected by continuing forward through the remaining real steps, or,
 *     if the sale itself was wrong, by the generic cancel/refund path above
 *     — never by stepping this enum backward.
 *   - DELIVERED is terminal — once handed to the customer there is nothing
 *     further to track. The only way "out" of a delivered insurance is the
 *     generic cancel/refund path (D4.2b), which does not touch this column
 *     at all (it is not in `MODULE_DEBT_TRANSACTION_TYPES`, it is a status
 *     column, not a charge).
 *
 * Pure and I/O-free (no DB, no clock — there is no time dimension to this
 * predicate, unlike carrierLineValidity.ts's `today` injection). This lets
 * `CustomServiceRepository` (mechanical read/write of the two columns),
 * `CustomServiceService` (the transition check, enforced SERVER-side —
 * unlike maintenance_jobs' `isPaidStatus` gate, which only checks
 * client-side and is the anti-pattern this ticket was told not to copy),
 * and the frontend all import the SAME list/type/predicate instead of three
 * drifting copies of the same four strings (rule 14). Must be exported from
 * `browser.ts` as well as `index.ts` — see the `telecomCredit.js` note in
 * `browser.ts` for the exact failure mode ("does not provide an export
 * named ...") a symbol missing there causes for Vite/frontend-jest.
 */

export const FULFILLMENT_STATUSES = [
  "ORDERED",
  "ISSUED",
  "RECEIVED",
  "DELIVERED",
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/** The only status with no legal outgoing transition — see the module doc
 *  comment's DELIVERED bullet. Named once so no call site re-spells the
 *  literal 'DELIVERED' to mean "terminal" (rule 14). */
export const TERMINAL_FULFILLMENT_STATUS: FulfillmentStatus = "DELIVERED";

/**
 * Whether advancing a custom service's fulfilment status FROM `from` TO `to`
 * is legal. STRICT, forward-only, single-step (see module doc comment):
 *
 *  - `from === null` means the row isn't fulfilment-tracked (an ordinary
 *    non-insurance custom service, or an insurance row that predates this
 *    ticket). Tracking only ever STARTS at creation time (stamped ORDERED by
 *    `CustomServiceRepository.createService`), never through this predicate
 *    — so every `from: null` call returns false; there is no "first"
 *    transition to validate here, only a starting value to insert.
 *  - Terminal (`DELIVERED`) accepts no further transition, forward or back.
 *  - Every other case must move to exactly the NEXT entry in
 *    `FULFILLMENT_STATUSES` — reject both skips (ORDERED -> RECEIVED) and
 *    backward moves (RECEIVED -> ISSUED), and reject a same-status call
 *    (ISSUED -> ISSUED is not a step at all).
 */
export function isValidFulfillmentTransition(
  from: FulfillmentStatus | null,
  to: FulfillmentStatus,
): boolean {
  if (from === null) return false;
  if (from === TERMINAL_FULFILLMENT_STATUS) return false;
  const fromIndex = FULFILLMENT_STATUSES.indexOf(from);
  const toIndex = FULFILLMENT_STATUSES.indexOf(to);
  return toIndex === fromIndex + 1;
}

/**
 * Payment-leg direction rules — pure, zero imports (LIRA-329).
 *
 * Moved out of `payments.ts` (which reaches the database through
 * `PaymentMethodRepository`) so a browser-safe module such as
 * `paymentSnapshot.ts` can classify legs with the SAME rule every money
 * repository books them by (rule 16), without pulling a Node-only import
 * chain into the renderer bundle (rule 29). `payments.ts` re-exports these,
 * so every existing import keeps working unchanged.
 */

/**
 * Direction of a payment leg.
 * - IN  → customer pays the shop (credits a drawer / uses account credit).
 * - OUT → shop returns change to the customer (debits a drawer / issues store credit).
 * Legs without an explicit direction are treated as IN (backward compatible).
 */
export type PaymentDirection = "IN" | "OUT";

/** Minimal shape shared by all payment-leg variants across the codebase. */
interface DirectionedLeg {
  direction?: PaymentDirection;
}

/** A leg is a return (OUT) only when explicitly marked; default is IN. */
export function isReturnLeg(leg: DirectionedLeg): boolean {
  return leg.direction === "OUT";
}

/**
 * Split a payment array into customer-paid IN legs and shop-returned OUT legs.
 * Legs with no `direction` default to IN, so existing callers are unaffected.
 */
export function partitionLegs<T extends DirectionedLeg>(
  payments: T[] | undefined | null,
): { inLegs: T[]; outLegs: T[] } {
  if (!payments || payments.length === 0) return { inLegs: [], outLegs: [] };
  const inLegs: T[] = [];
  const outLegs: T[] = [];
  for (const leg of payments) {
    if (isReturnLeg(leg)) outLegs.push(leg);
    else inLegs.push(leg);
  }
  return { inLegs, outLegs };
}

/**
 * The display `paid_by` label for a flow, derived from the legs the
 * customer ACTUALLY used: one leg's method, "MULTI" for two or more,
 * `fallback` when there are none. Same rule as the frontend's
 * `derivePaidByMethod` (frontend/src/utils/paymentUtils.ts) — one definition
 * per layer (rule 14). Callers pass IN legs only: an OUT (change) leg is not
 * a way the customer paid (rule 16). Display only — never a money input.
 */
export function derivePaidByLabel(
  legs: ReadonlyArray<{ method: string }>,
  fallback = "CASH",
): string {
  if (legs.length > 1) return "MULTI";
  if (legs.length === 1) return legs[0].method;
  return fallback;
}

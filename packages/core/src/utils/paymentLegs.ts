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

// ─── LIRA-391 — lump method flags vs payment legs ───────────────────────────
//
// A payout page used to remember "the" method from a one-line sheet and send
// it as `cashoutMethod` NEXT TO split `payments[]`. Core branched on the flag
// before the legs, so "$200 to the account + $328.06 Whish" credited the whole
// $528.06 to the account and never booked the Whish leg. These are the ONE
// definition (rule 14) of how a lump flag and the legs relate.

/** Minimal leg shape for the lump-flag helpers. */
interface MethodLeg {
  method: string;
  amount: number;
}

/** Does the caller send at least one leg with money on it? Zero-amount legs
 *  do not count (a page that sends one empty line keeps the flag path). */
export function hasPostingLegs(
  legs: ReadonlyArray<MethodLeg> | undefined | null,
): boolean {
  return !!legs && legs.some((l) => Math.abs(l.amount) > 0);
}

/**
 * ROUTING: the lump method flag, only when there are no posting legs.
 * Legs present ⇒ `undefined`: every leg is booked by its own method through
 * the per-leg path (which reconciles the legs), even when every leg is
 * CUSTOMER_ACCOUNT. A flag that disagrees with the legs is ignored, never
 * refused — every shipped page sent the stale flag. Callers pass IN legs.
 */
export function lumpFlagWhenNoLegs<T extends string>(
  flag: T | undefined | null,
  legs: ReadonlyArray<MethodLeg> | undefined | null,
): T | undefined {
  if (hasPostingLegs(legs)) return undefined;
  return flag ?? undefined;
}

/** What `payoutMethodOf` returns for legs that do not share one method. */
export const MIXED_PAYOUT_METHOD = "MIXED";

/**
 * ELIGIBILITY: what kind of payout this is, for the rules that ask (kept
 * change, round-up, added change, the legacy fee method, "does it touch the
 * customer's account"). Legs present ⇒ the method every posting leg shares,
 * else `MIXED_PAYOUT_METHOD`; no legs ⇒ the flag. Never a routing input —
 * money is routed by `lumpFlagWhenNoLegs`.
 */
export function payoutMethodOf(
  flag: string | undefined | null,
  legs: ReadonlyArray<MethodLeg> | undefined | null,
): string | undefined {
  if (!hasPostingLegs(legs)) return flag ?? undefined;
  const methods = new Set(
    legs!.filter((l) => Math.abs(l.amount) > 0).map((l) => l.method),
  );
  return methods.size === 1 ? [...methods][0] : MIXED_PAYOUT_METHOD;
}

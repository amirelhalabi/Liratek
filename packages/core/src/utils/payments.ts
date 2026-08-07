/**
 * Canonical payment method utilities.
 *
 * IMPORTANT: We keep DB-stored method values backward compatible.
 * These values appear in `payments.method` and various `*_paid_by_method` columns.
 *
 * These functions now delegate to the `payment_methods` DB table for resolution.
 * A hardcoded fallback remains so the functions work even if the DB isn't
 * initialised yet (e.g. during tests).
 */

import { getPaymentMethodRepository } from "../repositories/PaymentMethodRepository.js";
import { primaryCashDrawerName } from "../constants/systemFloatDrawers.js";

/** Payment method code — now a plain string (dynamic from DB). */
export type PaymentMethod = string;

/** Hardcoded fallback map (used when DB is unavailable). */
const FALLBACK_DRAWER_MAP: Record<string, string> = {
  CASH: "General",
  OMT: "OMT_App",
  WHISH: "Whish_App",
  BINANCE: "Binance",
  CUSTOMER_ACCOUNT: "General",
};

/** Methods that never move a drawer (value is tracked outside the cash drawers). */
const NON_DRAWER_METHODS = new Set(["CUSTOMER_ACCOUNT", "GIFT_CARD"]);

/**
 * LIRA-105 follow-up — the set of codes this file KNOWS about (rule 14: ONE
 * definition, not hand-duplicated literals). Built from the two maps already
 * above, so it can never drift from them:
 *   - `FALLBACK_DRAWER_MAP` keys   → CASH, OMT, WHISH, BINANCE, CUSTOMER_ACCOUNT
 *   - `NON_DRAWER_METHODS`         → CUSTOMER_ACCOUNT, GIFT_CARD
 * Used below to distinguish a *canonical* code with a temporarily-missing DB
 * row (deleted/unseeded method, or a mocked DB in tests) from a *truly
 * unknown* code (typo, retired sentinel, garbage input).
 */
const CANONICAL_METHODS = new Set<string>([
  ...Object.keys(FALLBACK_DRAWER_MAP),
  ...NON_DRAWER_METHODS,
]);

/**
 * LIRA-105 — ONE definition (rule 14) of what a *truly unregistered*
 * payment-method code means (the DB was reachable and `getByCode()` ran, no
 * `payment_methods` row exists for this tenant/code, AND the code is not one
 * of the app's canonical methods — see `CANONICAL_METHODS`).
 * `PaymentMethodRepository` is the source of truth for payment-method
 * configuration — `isDrawerAffecting(code)` returns `method?.affects_drawer
 * === 1`, which is `false` for an unregistered code — so both predicates
 * below defer to that same answer for a code they don't recognise, instead
 * of each guessing independently. Before the LIRA-105 fix they disagreed:
 * this file defaulted an unregistered code to drawer-affecting (`true`) via
 * `!NON_DRAWER_METHODS.has(method)`, the repository defaulted it to `false`.
 *
 * Canonical-code carve-out (LIRA-105 caused a regression here, fixed after):
 * a code IN `CANONICAL_METHODS` with no DB row does NOT hit this constant —
 * it falls through to the same hardcoded-map answer the `catch` block below
 * already returns. Two real reasons a canonical code's row can be missing
 * even though the DB itself is perfectly reachable:
 *   1. `TenantRepository.seedPaymentMethods()` seeds OMT/WHISH/BINANCE with
 *      `is_system = 0` — they are deletable per tenant. A shop that deletes
 *      its OMT method must NOT silently stop crediting the `OMT_App` drawer;
 *      that is real money, not a fallback-map nicety.
 *   2. `backend/jest.config.cjs` maps `better-sqlite3` to a mock, so
 *      `getDatabase()` never throws and `getByCode()` resolves `undefined`
 *      for every code in that test process — the DB-unavailable `catch`
 *      path is never exercised there, so without this carve-out canonical
 *      codes would wrongly read as unregistered garbage in every backend
 *      test that imports these predicates.
 * A code NOT in `CANONICAL_METHODS` (typo, retired sentinel like the old
 * `"FEE"` literal, a hard-rejected sentinel like `"MULTI"`, or genuine
 * garbage input) still resolves to `false` here — it must not fall through
 * to `paymentMethodToDrawerName`'s own `?? "General"` default and silently
 * post real money into the General drawer for a code nobody configured.
 *
 * Does NOT apply to the DB-*unavailable* fallback (the `catch` blocks
 * below) — that path always uses the hardcoded map regardless of whether
 * the code is canonical, so known codes (CASH/OMT/WHISH/BINANCE) keep
 * resolving correctly in tests that run without a `payment_methods` table.
 */
const UNREGISTERED_METHOD_IS_DRAWER_AFFECTING = false;

export function isDrawerAffectingMethod(method: string): boolean {
  try {
    const repo = getPaymentMethodRepository();
    const pm = repo.getByCode(method);
    if (pm) return pm.affects_drawer === 1;
    if (!CANONICAL_METHODS.has(method)) {
      return UNREGISTERED_METHOD_IS_DRAWER_AFFECTING;
    }
    // Canonical code, no DB row (deleted/unseeded method, or a mocked DB in
    // tests) — fall through to the same hardcoded-map answer the `catch`
    // block below returns.
  } catch {
    // DB not available (e.g. not yet initialised in a test) — hardcoded map.
  }
  return !NON_DRAWER_METHODS.has(method);
}

/**
 * Returns true if the method is a wallet/non-cash drawer-affecting method.
 *
 * - CASH             → false (cash goes through General)
 * - CUSTOMER_ACCOUNT → false (no drawer at all)
 * - OMT / WHISH / BINANCE / any wallet → true
 */
export function isNonCashDrawerMethod(method: string): boolean {
  if (NON_DRAWER_METHODS.has(method)) return false;
  try {
    const repo = getPaymentMethodRepository();
    const pm = repo.getByCode(method);
    if (pm) return pm.affects_drawer === 1 && pm.drawer_name !== "General";
    if (!CANONICAL_METHODS.has(method)) {
      // Unregistered code (LIRA-105): matches isDrawerAffectingMethod — not
      // drawer-affecting at all, so it can't be a non-cash drawer method
      // either.
      return UNREGISTERED_METHOD_IS_DRAWER_AFFECTING;
    }
    // Canonical code, no DB row — fall through to the hardcoded list below,
    // same carve-out as isDrawerAffectingMethod (see the doc comment above
    // UNREGISTERED_METHOD_IS_DRAWER_AFFECTING).
  } catch {
    // DB not available — fall through to hardcoded list
  }
  return method !== "CASH" && !NON_DRAWER_METHODS.has(method);
}

export function paymentMethodToDrawerName(method: string): string {
  try {
    const repo = getPaymentMethodRepository();
    const pm = repo.getByCode(method);
    if (pm) return pm.drawer_name;
  } catch {
    // DB not available
  }
  return FALLBACK_DRAWER_MAP[method] ?? "General";
}

/**
 * Primary-System Cash Drawer plan §8.2 (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md):
 * the shop's two "system" providers, OMT and WHISH, each have a base/primary
 * variant (`shop_base_system`). `OMT_System`/`Whish_System` are no longer a
 * spendable float held inside the provider's own books (PR #66's model,
 * rejected by the owner 2026-07-30) — they ARE the physical cash drawer at
 * the money-transfer counter for whichever system is primary. Every cash leg
 * of a primary-system SEND/RECEIVE (customer payment, payout, change, fee)
 * must land there instead of General.
 */
export type BaseSystem = "OMT" | "WHISH";

/** Context a call site threads into {@link resolveServiceCashDrawer}: which
 *  provider this leg's transaction runs on, and which system is primary. */
export interface ServiceCashDrawerContext {
  provider: string;
  baseSystem: BaseSystem;
}

/**
 * Primary Cash Drawer routing resolver (rule 14 — the ONE definition; plan
 * §8.2). Returns the primary cash drawer (PCD) — `OMT_System`/`Whish_System`
 * per `ctx.baseSystem` — iff ALL hold, else falls through to
 * `paymentMethodToDrawerName(method)` unchanged:
 *
 *  1. `ctx.provider === ctx.baseSystem` (string equality) — the transaction
 *     runs ON the primary system. Partner involvement is NOT part of this
 *     predicate (plan decision #6: route by the system the transaction runs
 *     on, not the counterparty) — a THROUGH-partner transaction runs on the
 *     SECONDARY provider and falls out naturally; a FOR-partner transaction
 *     runs on the primary provider and DOES route here. `"OMT_APP"` never
 *     equals `"OMT"`, so app-wallet/Binance transfers fall through
 *     automatically (decision #5 — they stay on their own wallet drawer /
 *     General, unaffected by this feature).
 *  2. `isDrawerAffectingMethod(method)` — a non-drawer tender (CUSTOMER_ACCOUNT,
 *     GIFT_CARD) never reaches a drawer at all.
 *  3. `paymentMethodToDrawerName(method) === "General"` — only a cash-family
 *     tender (bound to General today) is eligible to be rerouted; a tender
 *     already bound to its OWN drawer (a wallet method) keeps that drawer.
 *  4. `method !== "GIFT_CARD"` — belt-and-suspenders: a voucher is not
 *     banknotes and must never land in the cash drawer, even if a future
 *     seed change ever flipped GIFT_CARD's `affects_drawer` flag.
 *
 * Does NOT repoint `payment_methods.CASH.drawer_name` — blocked twice
 * (`PaymentMethodRepository.ts`'s `is_system` guard, and
 * `isNonCashDrawerMethod` testing `drawer_name !== "General"`); this resolver
 * is a call-site-level override, not a global remap.
 */
export function resolveServiceCashDrawer(
  method: string,
  ctx: ServiceCashDrawerContext,
): string {
  if (
    ctx.provider === ctx.baseSystem &&
    isDrawerAffectingMethod(method) &&
    paymentMethodToDrawerName(method) === "General" &&
    method !== "GIFT_CARD"
  ) {
    return primaryCashDrawerName(ctx.baseSystem);
  }
  return paymentMethodToDrawerName(method);
}

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

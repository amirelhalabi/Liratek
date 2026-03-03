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

/** Payment method code — now a plain string (dynamic from DB). */
export type PaymentMethod = string;

/** Hardcoded fallback map (used when DB is unavailable). */
const FALLBACK_DRAWER_MAP: Record<string, string> = {
  CASH: "General",
  OMT: "OMT_App",
  WHISH: "Whish_App",
  BINANCE: "Binance",
  DEBT: "General",
};

export function isDrawerAffectingMethod(method: string): boolean {
  try {
    const repo = getPaymentMethodRepository();
    const pm = repo.getByCode(method);
    if (pm) return pm.affects_drawer === 1;
  } catch {
    // DB not available
  }
  // Fallback: DEBT is the only non-drawer-affecting method
  return method !== "DEBT";
}

/**
 * Returns true if the method is a wallet/non-cash drawer-affecting method.
 *
 * Used to gate payment-method-fee logic and to decide whether the RESERVE
 * entry for an OMT/WHISH SEND should come from General (cash) or from the
 * payment method's own drawer (wallet).
 *
 * - CASH  → false (cash goes through General)
 * - DEBT  → false (no drawer at all)
 * - OMT / WHISH / BINANCE / any wallet → true
 */
export function isNonCashDrawerMethod(method: string): boolean {
  if (method === "DEBT") return false;
  try {
    const repo = getPaymentMethodRepository();
    const pm = repo.getByCode(method);
    if (pm) return pm.affects_drawer === 1 && pm.drawer_name !== "General";
  } catch {
    // DB not available — fall through to hardcoded list
  }
  // Fallback: anything that is not CASH/DEBT and not General-routed
  return method !== "CASH" && method !== "DEBT";
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

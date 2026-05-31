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
  CUSTOMER_ACCOUNT: "General",
};

/** Methods that never move a drawer (value is tracked outside the cash drawers). */
const NON_DRAWER_METHODS = new Set(["CUSTOMER_ACCOUNT", "GIFT_CARD"]);

export function isDrawerAffectingMethod(method: string): boolean {
  try {
    const repo = getPaymentMethodRepository();
    const pm = repo.getByCode(method);
    if (pm) return pm.affects_drawer === 1;
  } catch {
    // DB not available
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
 * Sum CUSTOMER_ACCOUNT payment lines by currency.
 * Used to validate that a client has enough credit before persisting a transaction.
 */
export function sumCustomerAccountByCurrency(
  payments:
    | Array<{ method: string; currencyCode: string; amount: number }>
    | undefined
    | null,
): { usd: number; lbp: number } {
  if (!payments || payments.length === 0) return { usd: 0, lbp: 0 };
  let usd = 0;
  let lbp = 0;
  for (const line of payments) {
    if (line.method !== "CUSTOMER_ACCOUNT") continue;
    if (line.currencyCode === "USD") usd += line.amount;
    else if (line.currencyCode === "LBP") lbp += line.amount;
  }
  return { usd, lbp };
}

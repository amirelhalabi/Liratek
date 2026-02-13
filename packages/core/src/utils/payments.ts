/**
 * Canonical payment method utilities.
 *
 * IMPORTANT: We keep DB-stored method values backward compatible.
 * These values appear in `payments.method` and various `*_paid_by_method` columns.
 */

export type PaymentMethod = "CASH" | "DEBT" | "OMT" | "WHISH" | "BINANCE";

export function isDrawerAffectingMethod(method: PaymentMethod): boolean {
  // DEBT means no money moved into a drawer at the moment of transaction.
  return method !== "DEBT";
}

export function paymentMethodToDrawerName(method: PaymentMethod): string {
  switch (method) {
    case "CASH":
      return "General";
    case "OMT":
      return "OMT_System";
    case "WHISH":
      return "Whish_App";
    case "BINANCE":
      return "Binance";
    case "DEBT":
      // No drawer impact; returning General is a safe default if needed.
      return "General";
    default:
      return "General";
  }
}

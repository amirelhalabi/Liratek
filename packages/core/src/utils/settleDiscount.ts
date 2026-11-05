/**
 * LIRA-372 — the one screen helper behind the Discount line on every settle
 * screen (Debts Repay, Suppliers Pay / Receive, batch Settle, Settle Account,
 * Partners by day and by amount). Pure and browser-safe (rule 29): imports
 * only the cap from validators/exchange.ts.
 *
 * `owed` is what is owed in that currency BEFORE the payment, net of any
 * credit used (research R2). Measuring the room AFTER the payment would make
 * it shrink as the payment line follows the discount, and lock at 0.
 */
import {
  KEPT_CHANGE_ROUNDING_TOLERANCE,
  SHORTFALL_MAX,
} from "../validators/exchange.js";

export type SettleDiscountCurrency = "USD" | "LBP";

/** Cents for USD, whole lira for LBP. */
function roundIn(currency: SettleDiscountCurrency, n: number): number {
  return currency === "USD" ? Math.round(n * 100) / 100 : Math.round(n);
}

/** How much discount the line accepts: min($5 / 450,000 LBP, owed), ≥ 0. */
export function settleDiscountRoom(
  currency: SettleDiscountCurrency,
  owed: number,
): number {
  const o = Number.isFinite(owed) ? Math.max(0, owed) : 0;
  return roundIn(currency, Math.min(SHORTFALL_MAX[currency], o));
}

/**
 * The discount actually applied for a typed amount: rounded, floored at 0,
 * and clamped to the room. `capped` drives DiscountLine's cap note.
 */
export function clampSettleDiscount(
  currency: SettleDiscountCurrency,
  typed: number,
  owed: number,
): { applied: number; capped: boolean; room: number } {
  const room = settleDiscountRoom(currency, owed);
  const t = Number.isFinite(typed) ? Math.max(0, roundIn(currency, typed)) : 0;
  return t > room
    ? { applied: room, capped: true, room }
    : { applied: t, capped: false, room };
}

/**
 * True when payment + discount is more than what is owed (within half a
 * cent / half a lira). Screens block Confirm on it when the cashier typed the
 * payment by hand and then added a discount (FR-010).
 */
export function settleDiscountOverpaid(
  currency: SettleDiscountCurrency,
  owed: number,
  paid: number,
  discount: number,
): boolean {
  return paid + discount > owed + KEPT_CHANGE_ROUNDING_TOLERANCE[currency];
}

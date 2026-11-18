/**
 * LIRA-400 — payment-method fee on a payment line.
 *
 * The ONE definition (rule 14) of which payment lines may carry a fee the
 * cashier types (a wallet line: OMT wallet, Whish, Binance, any method whose
 * drawer is not the General cash drawer), the caps on it, the refusal
 * messages, and the "price part" of a stored leg. Used by the payment screen
 * (MultiPaymentInput, with its own payment-method list) and by the server
 * (schemas + repositories, with the DB-backed method lookup) so the two can
 * never disagree.
 *
 * Leaf module (rule 29): reachable from `browser.ts`, so it imports nothing —
 * no Node built-in, no database. Callers pass the method's facts in.
 *
 * Storage model (specs/400-payment-method-fee/spec.md, settled design 2):
 * `payments.amount` stays the WHOLE drawer movement (price part + fee) and
 * `payments.fee_amount` is the fee inside it. The price part of a leg is
 * therefore `amount - fee_amount` — see `priceOnlyLegRow`.
 */

/** Methods that never carry a fee, whatever the method table says. */
const NEVER_FEE_METHODS = new Set(["CASH", "CUSTOMER_ACCOUNT", "GIFT_CARD"]);

/** The General cash drawer — a method posting there is cash-family. */
const CASH_FAMILY_DRAWER = "General";

/** Tolerance for "fee ≤ amount" against float noise (well below 1 cent). */
const LEG_FEE_EPSILON = 1e-9;

export const LEG_FEE_RANGE_MESSAGE =
  "Payment method fee must be between 0 and the line's amount";
export const LEG_FEE_OUT_MESSAGE =
  "A fee can only be charged on money the customer pays in";
export const LEG_FEE_METHOD_MESSAGE =
  "A fee can only be charged on a wallet payment line (not cash, account or gift card)";

/** What a caller knows about a payment method. */
export interface LegFeeMethodInfo {
  code: string;
  /** The drawer the method posts to (`payment_methods.drawer_name`). */
  drawerName?: string | null;
  /** `payment_methods.affects_drawer` (as boolean). */
  affectsDrawer?: boolean | null;
}

/**
 * True when a line paid with this method may carry a fee: a drawer-moving
 * method whose drawer is not General, and never cash, customer account or
 * gift card.
 */
export function isLegFeeEligibleMethod(info: LegFeeMethodInfo): boolean {
  if (!info.code || NEVER_FEE_METHODS.has(info.code)) return false;
  if (info.affectsDrawer === false) return false;
  if (info.drawerName === CASH_FAMILY_DRAWER) return false;
  return true;
}

/** A leg's fee as a plain number (absent / null / NaN → 0). */
export function legFeeOf(leg: {
  fee_amount?: number | null;
  feeAmount?: number | null;
  fee?: number | null;
}): number {
  const raw = leg.fee_amount ?? leg.feeAmount ?? leg.fee ?? 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The checks that need no method table: 0 ≤ fee ≤ amount, never on a change
 * (OUT) leg, never on CASH / CUSTOMER_ACCOUNT / GIFT_CARD. Returns the
 * refusal message, or null when the leg is fine. A leg with no fee (0) is
 * always fine.
 */
export function legFeeShapeError(leg: {
  method: string;
  amount: number;
  fee: number;
  direction?: "IN" | "OUT" | undefined;
}): string | null {
  const fee = leg.fee;
  if (!Number.isFinite(fee) || fee < 0) return LEG_FEE_RANGE_MESSAGE;
  if (fee === 0) return null;
  if (leg.direction === "OUT") return LEG_FEE_OUT_MESSAGE;
  if (NEVER_FEE_METHODS.has(leg.method)) return LEG_FEE_METHOD_MESSAGE;
  if (fee > Math.abs(leg.amount) + LEG_FEE_EPSILON) return LEG_FEE_RANGE_MESSAGE;
  return null;
}

/** Full check: shape + the method's drawer (needs the method's facts). */
export function legFeeError(
  leg: {
    method: string;
    amount: number;
    fee: number;
    direction?: "IN" | "OUT" | undefined;
  },
  info: LegFeeMethodInfo,
): string | null {
  const shape = legFeeShapeError(leg);
  if (shape) return shape;
  if (leg.fee > 0 && !isLegFeeEligibleMethod(info)) return LEG_FEE_METHOD_MESSAGE;
  return null;
}

/**
 * The PRICE part of a stored `payments` row: `amount - fee_amount`, with the
 * fee zeroed. Idempotent (a row already reduced has fee 0, so a second pass
 * changes nothing). Every refund reader uses it so a refund — full, per item,
 * preview or method override — never hands the fee back (owner decision:
 * refund keeps the fee). A void does NOT use it: a void mirrors the whole
 * row, fee included.
 */
export function priceOnlyLegRow<
  T extends { amount: number; fee_amount?: number | null },
>(row: T): T & { fee_amount: number } {
  const fee = Number(row.fee_amount ?? 0) || 0;
  if (fee === 0) return { ...row, fee_amount: 0 };
  return { ...row, amount: row.amount - fee, fee_amount: 0 };
}

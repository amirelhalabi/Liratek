/**
 * LIRA-365 — the discount the cashier gives where a customer pays the shop
 * and the shop has no margin of its own to take it from (OMT/Whish system
 * SEND, voucher sale). The whole amount is still owed to the provider (or
 * stays on the voucher), so the shop books the discount as a books-only
 * "Discount given" expense (`repositories/discountGivenExpense.ts`).
 *
 * ONE definition (rule 14) of the cap and the wording, shared by the Zod
 * schemas and the repositories (offline replay skips the schemas). Pure leaf:
 * reachable from `browser.ts`, so no Node import at any depth (rule 29).
 */
import { isWithinShortfallMax } from "./exchange.js";

/** The expense category of a discount the shop gave (owner 2026-10-31). */
export const DISCOUNT_GIVEN_EXPENSE_CATEGORY = "Discount given";

export const DISCOUNT_ABOVE_CAP_MESSAGE =
  "The discount is more than $5 or 450,000 LBP — lower it.";
export const DISCOUNT_ABOVE_TOTAL_MESSAGE =
  "The discount must be less than what the customer pays.";
export const DISCOUNT_NOT_ALLOWED_MESSAGE =
  "A discount is only for an OMT or Whish send paid at the counter (not for a partner, not in a customer session).";
export const DISCOUNT_NEEDS_PAYMENTS_MESSAGE =
  "A discount needs the payment lines the customer paid with.";

/**
 * Discount and Waive close the same kind of gap, so together they stay
 * within the ONE shortfall cap (`SHORTFALL_MAX`), compared in the total's own
 * currency, never converted. Any other currency allows nothing.
 */
export function discountWithinCap(
  discount: number,
  waived: number,
  currency: string,
): boolean {
  return isWithinShortfallMax((discount || 0) + (waived || 0), currency);
}

/** Where an OMT/Whish financial-service discount may go: a walk-in system
 *  SEND, not FOR a partner, not a session-basket item. */
export function isSystemSendDiscountAllowed(data: {
  provider: string;
  serviceType: string;
  partnerMode?: string | null | undefined;
  deferPayment?: boolean | null | undefined;
}): boolean {
  return (
    (data.provider === "OMT" || data.provider === "WHISH") &&
    data.serviceType === "SEND" &&
    data.partnerMode !== "FOR" &&
    data.deferPayment !== true
  );
}

/**
 * The refusal for a financial-service discount, or null when it is allowed.
 * `total` = what the customer pays before the discount (principal + provider
 * fee; `amount` is always the net principal, even with "fee included").
 */
export function financialDiscountRefusal(data: {
  discount_amount?: number | null | undefined;
  customer_waived_amount?: number | null | undefined;
  provider: string;
  serviceType: string;
  partnerMode?: string | null | undefined;
  deferPayment?: boolean | null | undefined;
  currency?: string | null | undefined;
  hasPayments: boolean;
  total: number;
}): string | null {
  const discount = data.discount_amount ?? 0;
  if (!(discount > 0)) return null;
  if (!isSystemSendDiscountAllowed(data)) return DISCOUNT_NOT_ALLOWED_MESSAGE;
  if (!data.hasPayments) return DISCOUNT_NEEDS_PAYMENTS_MESSAGE;
  if (
    !discountWithinCap(
      discount,
      data.customer_waived_amount ?? 0,
      data.currency ?? "USD",
    )
  )
    return DISCOUNT_ABOVE_CAP_MESSAGE;
  if (discount >= data.total) return DISCOUNT_ABOVE_TOTAL_MESSAGE;
  return null;
}

/**
 * The refusal for a voucher-sale discount, or null when it is allowed.
 * `faceValue` = the voucher's amount, in `currency` (the voucher's own). The
 * customer pays face value − discount; the voucher keeps its face value.
 */
export function voucherDiscountRefusal(data: {
  discount_amount?: number | null | undefined;
  faceValue: number;
  currency?: string | null | undefined;
}): string | null {
  const discount = data.discount_amount ?? 0;
  if (!(discount > 0)) return null;
  if (!discountWithinCap(discount, 0, data.currency ?? "USD"))
    return DISCOUNT_ABOVE_CAP_MESSAGE;
  if (discount >= data.faceValue) return DISCOUNT_ABOVE_TOTAL_MESSAGE;
  return null;
}

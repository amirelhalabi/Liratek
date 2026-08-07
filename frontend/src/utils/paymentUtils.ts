/**
 * Payment utility functions
 */

import { PAYMENT_TOLERANCE } from "@/constants/checkout";
import type { PaymentLine } from "@liratek/ui";

/** Backend payment leg (camelCase shape — Recharge, Financial, Debt). */
export interface CamelPaymentLeg {
  method: string;
  currencyCode: string;
  amount: number;
  voucherCode?: string;
  direction?: "IN" | "OUT";
}

/** Backend payment leg (snake_case shape — Sales, Custom Services, Loto). */
export interface SnakePaymentLeg {
  method: string;
  currency_code: string;
  amount: number;
  voucher_code?: string;
  direction?: "IN" | "OUT";
}

/**
 * Build the camelCase `payments` array sent to the backend, appending any
 * shop→customer return (OUT) legs when the customer overpaid.
 */
export function toCamelLegs(
  lines: PaymentLine[],
  returnLegs?: PaymentLine[],
): CamelPaymentLeg[] {
  const all = returnLegs?.length ? [...lines, ...returnLegs] : lines;
  return all.map((l) => ({
    method: l.method,
    currencyCode: l.currencyCode,
    amount: l.amount,
    ...(l.voucherCode ? { voucherCode: l.voucherCode } : {}),
    ...(l.direction ? { direction: l.direction } : {}),
  }));
}

/** Same as {@link toCamelLegs} but with the snake_case leg shape. */
export function toSnakeLegs(
  lines: PaymentLine[],
  returnLegs?: PaymentLine[],
): SnakePaymentLeg[] {
  const all = returnLegs?.length ? [...lines, ...returnLegs] : lines;
  return all.map((l) => ({
    method: l.method,
    currency_code: l.currencyCode,
    amount: l.amount,
    ...(l.voucherCode ? { voucher_code: l.voucherCode } : {}),
    ...(l.direction ? { direction: l.direction } : {}),
  }));
}

/**
 * CARRIER_LINES_VALIDITY_PLAN.md Phase 7: derive the submitted
 * `paid_by_method`/`paidByMethod` DIRECTLY from the pay sheet's current
 * payment legs — the first leg's method, or `"MULTI"` once there are 2+ legs.
 * Matches the pattern already used by the crypto submit (Recharge/index.tsx
 * `handleCryptoSubmit`), FinancialForm and KatchForm.
 *
 * Do NOT rely on a `lines.length === 1`-gated setter alone (e.g. a
 * `MultiPaymentInput onPaymentChange` callback that only calls `setPaidBy`
 * when there is exactly one line): that self-heals the single-leg case
 * because `MultiPaymentInput` re-emits on mount before submit is possible,
 * but it NEVER fires for a split (2+ legs) — the removed in-form Payment
 * Method dropdown's stale value (or whatever the state last held) would be
 * sent as `paid_by_method` even though the customer actually split the
 * payment. Calling this at the point of building the submit payload (from
 * the CURRENT `paymentLines` array) fixes both cases in one place.
 *
 * `fallback` covers the zero-leg case (practically unreachable at submit
 * time — the pay sheet always seeds at least one line, rule 16) and mirrors
 * the crypto form's own always-"CASH" `cryptoPaidBy` default.
 */
export function derivePaidByMethod(
  lines: Array<{ method: string }>,
  fallback: string = "CASH",
): string {
  if (lines.length > 1) return "MULTI";
  if (lines.length === 1) return lines[0].method;
  return fallback;
}

/**
 * Calculates change due
 * @param paid - Amount paid
 * @param total - Total amount due
 * @returns Change amount (0 if underpaid)
 */
export function calculateChange(paid: number, total: number): number {
  return Math.max(0, paid - total);
}

/**
 * Calculates remaining amount to pay
 * @param paid - Amount paid
 * @param total - Total amount due
 * @returns Remaining amount (0 if overpaid)
 */
export function calculateRemaining(paid: number, total: number): number {
  return Math.max(0, total - paid);
}

/**
 * Checks if payment is complete (within tolerance)
 * @param paid - Amount paid
 * @param total - Total amount due
 * @returns true if payment is complete
 */
export function isPaymentComplete(paid: number, total: number): boolean {
  const remaining = calculateRemaining(paid, total);
  return remaining <= PAYMENT_TOLERANCE;
}

/**
 * Formats currency amount
 * @param amount - Amount to format
 * @param currency - Currency code (USD or LBP)
 * @returns Formatted currency string
 */
export function formatCurrency(
  amount: number,
  currency: "USD" | "LBP",
): string {
  if (currency === "USD") {
    return `$${amount.toFixed(2)}`;
  }
  return `${amount.toLocaleString()} LBP`;
}

/**
 * Converts LBP to USD using exchange rate
 * @param amountLBP - Amount in LBP
 * @param exchangeRate - Exchange rate (1 USD = X LBP)
 * @returns Amount in USD
 */
export function convertLBPToUSD(
  amountLBP: number,
  exchangeRate: number,
): number {
  if (exchangeRate <= 0) return 0;
  return amountLBP / exchangeRate;
}

/**
 * Converts USD to LBP using exchange rate
 * @param amountUSD - Amount in USD
 * @param exchangeRate - Exchange rate (1 USD = X LBP)
 * @returns Amount in LBP
 */
export function convertUSDtoLBP(
  amountUSD: number,
  exchangeRate: number,
): number {
  return amountUSD * exchangeRate;
}

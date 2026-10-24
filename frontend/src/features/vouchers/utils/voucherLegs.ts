import {
  LEG_RECONCILIATION_EPSILON_USD,
  VOUCHER_REFUND_METHODS,
  VOUCHER_SALE_METHODS,
  type VoucherPaymentLegInput,
  type VoucherRefundLegInput,
} from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";
import { toSnakeLegs } from "@/utils/paymentUtils";

export interface VoucherMethodOption {
  code: string;
  label: string;
}

// i18n-exempt: same English label as the payment_methods row it stands in for
const CASH_ONLY: readonly VoucherMethodOption[] = [{ code: "CASH", label: "Cash" }];

/**
 * What can pay for a voucher: the shop's active methods filtered to the SAME
 * allow-list the server enforces (rule 14). Customer account only when the
 * caller says the customer can be charged (name + phone); never Gift card.
 * Cash alone while the list loads, so the dropdown is never empty.
 */
export function voucherSaleMethodOptions(
  methods: readonly VoucherMethodOption[],
  canChargeAccount: boolean,
): VoucherMethodOption[] {
  const allowed = methods.filter(
    (m) =>
      (VOUCHER_SALE_METHODS as readonly string[]).includes(m.code) &&
      (canChargeAccount || m.code !== "CUSTOMER_ACCOUNT"),
  );
  return allowed.length > 0 ? allowed : [...CASH_ONLY];
}

/** The cash part of a refund is paid back with drawer methods only. */
export function voucherRefundMethodOptions(
  methods: readonly VoucherMethodOption[],
): VoucherMethodOption[] {
  const allowed = methods.filter((m) =>
    (VOUCHER_REFUND_METHODS as readonly string[]).includes(m.code),
  );
  return allowed.length > 0 ? allowed : [...CASH_ONLY];
}

function isCur(c: string): c is "USD" | "LBP" {
  return c === "USD" || c === "LBP";
}

/** Sale legs (IN lines + OUT change legs), zero lines dropped. */
export function toVoucherSaleLegs(
  lines: PaymentLine[],
  returnLegs?: PaymentLine[],
): VoucherPaymentLegInput[] {
  const out: VoucherPaymentLegInput[] = [];
  for (const l of toSnakeLegs(lines, returnLegs)) {
    if (!(VOUCHER_SALE_METHODS as readonly string[]).includes(l.method)) continue;
    if (!isCur(l.currency_code) || !(l.amount > 0)) continue;
    out.push({
      method: l.method as VoucherPaymentLegInput["method"],
      currency_code: l.currency_code,
      amount: l.amount,
      ...(l.direction ? { direction: l.direction } : {}),
    });
  }
  return out;
}

/** Refund payout legs (never a change leg), zero lines dropped. */
export function toVoucherRefundLegs(lines: PaymentLine[]): VoucherRefundLegInput[] {
  const out: VoucherRefundLegInput[] = [];
  for (const l of toSnakeLegs(lines)) {
    if (!(VOUCHER_REFUND_METHODS as readonly string[]).includes(l.method)) continue;
    if (!isCur(l.currency_code) || !(l.amount > 0)) continue;
    out.push({
      method: l.method as VoucherRefundLegInput["method"],
      currency_code: l.currency_code,
      amount: l.amount,
    });
  }
  return out;
}

/** Legs' net value (IN − OUT) in USD at the tender rate. */
export function legsValueUsd(
  legs: readonly { currency_code: string; amount: number; direction?: string | undefined }[],
  rate: number,
): number {
  return legs.reduce((sum, l) => {
    const usd = l.currency_code === "LBP" ? l.amount / rate : l.amount;
    return sum + (l.direction === "OUT" ? -usd : usd);
  }, 0);
}

/** Tolerance in USD: the server's own reconcile tolerance (rule 14), so the
 *  button and `reconcileLegs` never disagree. */
const COVER_EPS_USD = LEG_RECONCILIATION_EPSILON_USD;

/** True when the legs pay at least `target` (USD + LBP at the rate). */
export function legsCover(
  legs: readonly { currency_code: string; amount: number; direction?: string | undefined }[],
  target: { usd: number; lbp: number },
  rate: number,
): boolean {
  if (!(rate > 0)) return false;
  const need = target.usd + target.lbp / rate;
  return legsValueUsd(legs, rate) >= need - COVER_EPS_USD;
}

/** True when payout legs match `target` within tolerance (not short, not over). */
export function legsMatch(
  legs: readonly { currency_code: string; amount: number }[],
  target: { usd: number; lbp: number },
  rate: number,
): boolean {
  if (!(rate > 0)) return false;
  const need = target.usd + target.lbp / rate;
  return Math.abs(legsValueUsd(legs, rate) - need) <= COVER_EPS_USD;
}

/** What a voucher's sale took in, split into cash and on-account parts.
 *  Absent/0 totals = a legacy voucher that was never sold. */
export function voucherRefundParts(v: {
  sale_usd?: number;
  sale_lbp?: number;
  sale_account_usd?: number;
  sale_account_lbp?: number;
}) {
  const saleUsd = v.sale_usd ?? 0;
  const saleLbp = v.sale_lbp ?? 0;
  const accUsd = v.sale_account_usd ?? 0;
  const accLbp = v.sale_account_lbp ?? 0;
  return {
    legacy: !(saleUsd > 0) && !(saleLbp > 0),
    cash: {
      usd: Math.max(0, Math.round((saleUsd - accUsd) * 100) / 100),
      lbp: Math.max(0, Math.round(saleLbp - accLbp)),
    },
    account: { usd: accUsd, lbp: accLbp },
  };
}

/**
 * LIRA-078 — refund tender-selection modal, pure logic.
 *
 * Money contract (method-override ONLY, per currency): the refund's chosen
 * legs must sum to exactly the original transaction's own net customer-cash
 * total, per currency — the operator picks the METHOD (which drawer the
 * money leaves from), never the amount or the currency. Cross-currency
 * refunds are out of scope (see docs/plans/todo_plans for the follow-up).
 *
 * Kept as plain functions (no React) so this is unit-testable without
 * rendering the page — same pattern as cashFlow.ts / formatPaymentLegs.
 */

import type { TransactionPaymentLeg } from "./cashFlow";

/** One operator-chosen refund return leg — mirrors packages/core's
 *  `RefundLegOverride` shape (method + currency + amount, IN-magnitude). */
export interface RefundLegOverride {
  method: string;
  currencyCode: string;
  amount: number;
}

/** Same-currency amount-matching tolerance — no exchange-rate conversion is
 *  ever involved here (this is not `reconcileLegs`), just a per-currency
 *  equality check. LBP amounts are always whole numbers in this codebase. */
const EPSILON: Record<string, number> = { USD: 0.01, LBP: 1 };

function epsilonFor(currencyCode: string): number {
  return EPSILON[currencyCode] ?? 0.01;
}

/**
 * Net customer-facing total per currency from the transaction's OWN
 * structured payment legs (`row.payments` — LIRA-064's `getRecent` field;
 * the SAME data the Summary/Method columns already render, never
 * `account_payments`/CUSTOMER_ACCOUNT legs, which never move a drawer).
 * IN legs are positive, OUT (change given at sale time) legs are negative —
 * `signed_amount` already carries that sign.
 */
export function netByCurrency(
  legs: TransactionPaymentLeg[] | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const leg of legs ?? []) {
    out[leg.currency_code] = (out[leg.currency_code] ?? 0) + leg.signed_amount;
  }
  return out;
}

/**
 * Build the modal's default pre-fill: ONE line per original currency total
 * (the ticket's explicit contract), method defaulting to the FIRST leg's
 * method for that currency (array order is DB id ASC — the earliest-booked
 * leg for that currency; a deterministic, sane default the operator can
 * still change). A currency whose net rounds to ~0 is dropped — nothing to
 * refund in it.
 */
export function buildDefaultRefundLines(
  legs: TransactionPaymentLeg[] | undefined,
): RefundLegOverride[] {
  const net = netByCurrency(legs);
  const methodByCurrency: Record<string, string> = {};
  for (const leg of legs ?? []) {
    if (methodByCurrency[leg.currency_code] === undefined) {
      methodByCurrency[leg.currency_code] = leg.method;
    }
  }
  return Object.entries(net)
    .filter(
      ([currencyCode, amount]) => Math.abs(amount) > epsilonFor(currencyCode),
    )
    .map(([currencyCode, amount]) => ({
      method: methodByCurrency[currencyCode] ?? "CASH",
      currencyCode,
      amount: Math.abs(amount),
    }));
}

/**
 * True when `lines` (the modal's live state) is economically identical to
 * `defaults` (the pristine pre-fill computed on open) — same set of
 * currencies, same method per currency, same amount within tolerance.
 *
 * The caller uses this to decide whether to send `refundLegs` at all: when
 * the operator touched nothing, sending NO override keeps the confirm click
 * on the EXACT pre-LIRA-078 code path (byte-identical reversal) — "plain
 * refund (no modal interaction) behaves exactly as today" is enforced here,
 * not by hoping the override happens to reproduce the same result.
 */
export function linesMatchDefault(
  lines: RefundLegOverride[],
  defaults: RefundLegOverride[],
): boolean {
  if (lines.length !== defaults.length) return false;
  const byCurrency = new Map(defaults.map((d) => [d.currencyCode, d]));
  for (const line of lines) {
    const def = byCurrency.get(line.currencyCode);
    if (!def) return false;
    if (line.method !== def.method) return false;
    if (Math.abs(line.amount - def.amount) > epsilonFor(line.currencyCode)) {
      return false;
    }
  }
  return true;
}

/**
 * Client-side hint mirroring the backend's own hard-reject validation (the
 * repository is the real authority — this only gates the Confirm button and
 * shows the operator why it's disabled, matching the "amounts LOCKED
 * (validated-equal)" contract since MultiPaymentInput has no native
 * read-only mode). Returns a human-readable reason, or null when the totals
 * check out for every currency.
 */
export function validateRefundLines(
  lines: RefundLegOverride[],
  originalNet: Record<string, number>,
): string | null {
  const lineTotals: Record<string, number> = {};
  for (const line of lines) {
    lineTotals[line.currencyCode] =
      (lineTotals[line.currencyCode] ?? 0) + line.amount;
  }

  const relevantOriginal = Object.entries(originalNet).filter(
    ([currencyCode, amount]) => Math.abs(amount) > epsilonFor(currencyCode),
  );
  const currencies = new Set([
    ...relevantOriginal.map(([c]) => c),
    ...Object.keys(lineTotals),
  ]);

  for (const currency of currencies) {
    const original = Math.abs(originalNet[currency] ?? 0);
    const chosen = lineTotals[currency] ?? 0;
    if (Math.abs(original - chosen) > epsilonFor(currency)) {
      return `Return total for ${currency} must equal ${original.toLocaleString()} (currently ${chosen.toLocaleString()}).`;
    }
  }
  return null;
}

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
 * (the ticket's explicit contract). Method defaults to the method of the
 * SINGLE leg with the LARGEST absolute `signed_amount` for that currency —
 * ties broken by keeping the first one seen (stable array order) — NOT the
 * first leg in array/id order alone.
 *
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md Phase B (plan §2 bug 4): a fee-on-top
 * RECEIVE books its customer-paid fee leg BEFORE the payout leg(s), so
 * "first leg wins" used to default the return method to the FEE's method —
 * the smaller of the two legs, and on legacy rows literally the retired
 * "FEE" literal, which isn't even in the modal's selectable method list and
 * which the backend hard-rejects as not-an-active-method. Picking the
 * LARGEST-magnitude leg instead means the payout (always the bigger leg on
 * a fee-on-top RECEIVE, since the fee is a fraction of the principal) wins
 * the default, matching what the operator actually handed back/received.
 *
 * `selectableMethodCodes` is the modal's own active/drawer-affecting method
 * list (`paymentMethods.map(m => m.code)`, the same list rendered in the
 * method dropdown) — a candidate method that isn't in that list (the
 * retired "FEE" string, or any method since deactivated) is never used as a
 * default; CASH is the fallback since it is a system method
 * (`PaymentMethodRepository`'s `is_system` guard keeps it present/active in
 * every install).
 *
 * A currency whose net rounds to ~0 is dropped — nothing to refund in it.
 */
export function buildDefaultRefundLines(
  legs: TransactionPaymentLeg[] | undefined,
  selectableMethodCodes: string[],
): RefundLegOverride[] {
  const net = netByCurrency(legs);
  const selectable = new Set(selectableMethodCodes);

  const largestLegByCurrency: Record<
    string,
    { method: string; magnitude: number }
  > = {};
  for (const leg of legs ?? []) {
    const magnitude = Math.abs(leg.signed_amount);
    const current = largestLegByCurrency[leg.currency_code];
    // Strict `>` (not `>=`) so a tie keeps the FIRST leg seen for that
    // currency, matching the ticket's "ties: first" contract.
    if (!current || magnitude > current.magnitude) {
      largestLegByCurrency[leg.currency_code] = {
        method: leg.method,
        magnitude,
      };
    }
  }

  return Object.entries(net)
    .filter(
      ([currencyCode, amount]) => Math.abs(amount) > epsilonFor(currencyCode),
    )
    .map(([currencyCode, amount]) => {
      const candidate = largestLegByCurrency[currencyCode]?.method;
      const method =
        candidate !== undefined && selectable.has(candidate)
          ? candidate
          : "CASH";
      return { method, currencyCode, amount: Math.abs(amount) };
    });
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

/**
 * LIRA-143 Phase 6b — the phone-refund UI's per-unit extra, riding alongside
 * `refundLegs` on the SAME `refundTransaction` call. Mirrors the backend's
 * `RefundUnitExtraOverride` shape (independently duplicated here, same as
 * `RefundLegOverride` above is independently duplicated from
 * `@/api/backendApi`'s own copy — each layer of the dual-mode stack keeps
 * its own small DTO rather than cross-importing).
 */
export interface RefundUnitExtraOverride {
  unit_id: number;
  is_defective?: boolean;
  warranty_override_until?: string | null;
}

/**
 * RefundMethodModal's live per-unit form state — one entry per unit the
 * operator has interacted with. A unit absent from this map, or present but
 * with both fields at their untouched default (`isDefective: false`,
 * `warrantyUntil: ""`), contributes NOTHING to the emitted extras — see
 * `buildUnitExtras`.
 */
export interface UnitFlagState {
  isDefective: boolean;
  /** ISO date string (`YYYY-MM-DD`, matches a native `<input type="date">`),
   *  or `""` for "not set — never override". */
  warrantyUntil: string;
}

/**
 * Build the `unitExtras` payload RefundMethodModal sends alongside
 * `refundLegs`. Mirrors `linesMatchDefault`'s "operator touched nothing ->
 * no override" contract for the units side: a unit whose defective checkbox
 * is unchecked AND whose warranty-override date is blank contributes no
 * entry at all, and if EVERY linked unit is untouched this returns
 * `undefined` (never `[]`) so the caller omits the argument entirely from
 * the `refundTransaction` call — same "send nothing when nothing changed"
 * contract as `refundLegs` above.
 */
export function buildUnitExtras(
  unitIds: number[],
  flags: Record<number, UnitFlagState>,
): RefundUnitExtraOverride[] | undefined {
  const entries: RefundUnitExtraOverride[] = [];
  for (const id of unitIds) {
    const flag = flags[id];
    if (!flag) continue;
    const warrantyUntil = flag.warrantyUntil.trim();
    if (!flag.isDefective && warrantyUntil === "") continue;
    const entry: RefundUnitExtraOverride = { unit_id: id };
    if (flag.isDefective) entry.is_defective = true;
    if (warrantyUntil !== "") entry.warranty_override_until = warrantyUntil;
    entries.push(entry);
  }
  return entries.length > 0 ? entries : undefined;
}

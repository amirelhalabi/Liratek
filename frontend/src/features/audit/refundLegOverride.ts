/**
 * LIRA-078 — refund tender-selection modal, pure logic.
 *
 * Money contract, ORIGINAL (method-override ONLY, per currency): the
 * refund's chosen legs must sum to exactly the original transaction's own
 * net customer-cash total, per currency — the operator picks the METHOD
 * (which drawer the money leaves from), never the amount or the currency.
 *
 * LIRA-236 (docs/plans/done_plans/REFUND_EXCHANGE_RATE_PLAN.md) replaces
 * that per-currency rule inside RefundMethodModal with `validateRefundValue`
 * below: the exchange rate shown in the popup is now editable, and any
 * currency mix whose TOTAL VALUE at that rate equals the refund's total
 * value is accepted (owner decision 2026-09-27 — "a $50 item paid in USD can
 * be refunded as 4,450,000 LBP, or $20 plus the rest in LBP"). The original
 * per-currency `validateRefundLines` is kept as-is (own tests, own callers —
 * `linesMatchDefault`'s "operator touched nothing" default-detection still
 * uses the ORIGINAL per-currency defaults, unaffected by this).
 *
 * Kept as plain functions (no React) so this is unit-testable without
 * rendering the page — same pattern as cashFlow.ts / formatPaymentLegs.
 */

import {
  REFUND_KEPT_CHANGE_TYPES,
  REFUND_LEG_AMOUNT_EPSILON,
  REFUND_VALUE_TOLERANCE_USD,
  type RefundLegInput,
  type RefundUnitExtraInput,
} from "@liratek/core";
import { convert, type RateTable, type PaymentLine } from "@liratek/ui";

import type { TransactionPaymentLeg } from "./cashFlow";

/** One operator-chosen refund return leg. Type alias for the core schema's
 *  own `RefundLegInput` (`refundLegSchema`, packages/core/src/validators/
 *  transaction.ts) — never a hand-copied second definition (rule 21).
 *  `currencyCode` is `"USD" | "LBP"`: the only place a wider (loose-string)
 *  currency turns into one of these is `toRefundLegs` below. */
export type RefundLegOverride = RefundLegInput;

/** `RefundLegOverride`/`RefundLegInput`'s own currency union, as a runtime
 *  type guard — the ONE predicate every "does this line's currency survive
 *  into a refund leg" check reuses (rule 14). Never widen this into
 *  "anything that isn't LBP is USD" (see `toRefundLegs`'s doc comment for
 *  the exact bug that pattern caused). */
function isRefundCurrency(code: string): code is "USD" | "LBP" {
  return code === "USD" || code === "LBP";
}

/**
 * The ONE boundary where a `MultiPaymentInput` line (`PaymentLine`,
 * `@liratek/ui` — `currencyCode: string`, loose, since that component is
 * shared across every currency-configurable flow) narrows into a typed
 * `RefundLegOverride` (`currencyCode: "USD" | "LBP"`). Every caller that
 * turns live `PaymentLine[]` state into refund legs (RefundMethodModal's
 * own payment section today) MUST go through this — never a hand-rolled
 * `currencyCode === "LBP" ? "LBP" : "USD"` ternary (rule 14).
 *
 * That old ternary pattern silently mapped ANY other currency — e.g. a
 * USDT line — to `"USD"`, which would have shipped a USDT leg as a USD one:
 * a latent money bug. This helper never coerces; a line whose currency is
 * neither USD nor LBP is DROPPED instead, matching what the server does
 * (`refundLegSchema`'s `currencyCode: z.enum(["USD", "LBP"])` hard-rejects
 * anything else). Dropping the leg removes its amount from the override
 * total, so the modal's own value-based validation (`validateRefundValue`)
 * naturally fails and Confirm stays disabled — the operator never gets to
 * submit money the server would reject anyway. A `amount <= 0` line is
 * dropped too, same as the pre-existing `toOverride` it replaces.
 */
export function toRefundLegs(lines: PaymentLine[]): RefundLegOverride[] {
  return lines
    .filter(
      (l): l is PaymentLine & { currencyCode: "USD" | "LBP" } =>
        l.amount > 0 && isRefundCurrency(l.currencyCode),
    )
    .map((l) => ({
      method: l.method,
      currencyCode: l.currencyCode,
      amount: l.amount,
    }));
}

/** Same-currency amount-matching tolerance — no exchange-rate conversion is
 *  ever involved here (this is not `reconcileLegs`), just a per-currency
 *  equality check. LBP amounts are always whole numbers in this codebase.
 *
 *  LIRA-232 round-2 review (finding 5) once widened this to `LBP: 100` to
 *  tolerate a session-item refund's `defaultLegs` (core used to round
 *  `itemAmountLbp`/`accountReductionLbp` independently, so an untouched
 *  default could land a few LBP off a naive subtraction). That widened ONLY
 *  this frontend copy while `TransactionRepository.validateRefundLegOverrideAmounts`
 *  kept `LBP: 1` server-side — a rule-14 drift where the form accepted an
 *  amount the server then rejected. Core now rounds every LBP remainder and
 *  default leg to whole LBP (`SESSION_ITEM_REFUND_PLAN.md` §3), so an
 *  untouched default passes the server's own 1-LBP check and there is no
 *  longer a reason for the two tolerances to differ. Both sides now import
 *  the SAME `REFUND_LEG_AMOUNT_EPSILON` from `@liratek/core`
 *  (`packages/core/src/constants/refundTolerance.ts`) — this is the only
 *  definition, never a second local copy. */
function epsilonFor(currencyCode: string): number {
  return (
    REFUND_LEG_AMOUNT_EPSILON[currencyCode] ?? REFUND_LEG_AMOUNT_EPSILON.USD
  );
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
 * A currency that isn't USD/LBP is dropped too (`isRefundCurrency`) — the
 * original transaction's own legs are USD/LBP-only by the money contract
 * this file's header documents, but `TransactionPaymentLeg.currency_code`
 * is typed as a loose `string`, so this stays a real filter, not a no-op
 * assertion, and never silently reinterprets a stray currency as USD.
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
    .filter(
      (entry): entry is ["USD" | "LBP", number] => isRefundCurrency(entry[0]),
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

/** A USD-based rate table for ONE rate (1 USD = `rate` LBP) — mirrors
 *  MultiPaymentInput's own `internalRates` construction (rule 14: this is
 *  the same USD/LBP pair the popup's rate field edits, not a second
 *  definition of what "the rate" means). */
function usdRateTable(rate: number): RateTable {
  return { base: "USD", rates: { LBP: { buy: rate, sell: rate } } };
}

/** Convert one currency's SIGNED amount to its USD-equivalent at `rate`.
 *  Mirrors MultiPaymentInput's own `convertSafe` fallback (rule 14): an
 *  unknown/degenerate pair passes through unconverted rather than throwing,
 *  since this only feeds a Confirm-button hint, never money movement. */
function toUsd(amount: number, currencyCode: string, rate: number): number {
  if (currencyCode === "USD") return amount;
  const table = usdRateTable(rate);
  try {
    return convert({ amount, currency: currencyCode }, "USD", table, "buy").amount;
  } catch {
    return amount;
  }
}

/**
 * LIRA-236 — value-based refund-line validation, replacing
 * `validateRefundLines` above inside RefundMethodModal: the TOTAL VALUE of
 * `lines`, converted to USD at `rate`, must equal the SIGNED value of the
 * original's own net customer-facing legs (`originalNet`), also converted at
 * `rate` and taken as one absolute number. Any currency mix is accepted as
 * long as the value matches — not just a currency-for-currency reproduction
 * of what was originally paid (owner decision 2026-09-27,
 * REFUND_EXCHANGE_RATE_PLAN.md §1).
 *
 * LIRA-236 round-2/final review, finding F1 (BLOCKER) — this used to
 * `Math.abs` EACH CURRENCY of `originalNet` before summing, which STACKS an
 * IN leg and an OUT leg in different currencies instead of netting them (a
 * $100 sale with 895,000 LBP change given back is a NET $90 sale, not a
 * "$110" one; an even-rate exchange that nets to $0 is not a "$200" refund).
 * The fix sums `originalNet`'s SIGNED per-currency values FIRST and only
 * THEN takes one absolute value (`originalValueUsd`) — mirroring
 * `TransactionRepository.validateRefundLegOverrideAmounts`'s `exchangeRate`
 * branch EXACTLY (rule 14), including a detail that looks like it should be
 * symmetric but is deliberately NOT: `lines` (the chosen legs) are summed as
 * plain POSITIVE MAGNITUDES, never per-currency-signed. An earlier draft of
 * this fix inherited each override leg's sign from ITS OWN currency's
 * original net (so a split across two opposite-signed currencies could
 * CANCEL itself back to $0) — that diverges from the server, which only
 * ever ADDS an override leg's magnitude, so the frontend would show Confirm
 * enabled for a payload the server then rejects. See
 * `refundLegOverride.test.ts`'s "does NOT self-cancel" case for the exact
 * numbers that catch this.
 *
 * Tolerance: `REFUND_VALUE_TOLERANCE_USD` (F9) — the SAME shared constant the
 * server uses for this exact value-based check, not the tighter
 * `REFUND_LEG_AMOUNT_EPSILON.USD` `validateRefundLines` uses for its
 * same-currency exact-match rule (rule 14: no second refund-tolerance
 * constant, and no drift between the frontend hint and the server's own
 * check it mirrors).
 */
export function validateRefundValue(
  lines: RefundLegOverride[],
  originalNet: Record<string, number>,
  rate: number,
  /** Owner decision 2026-10-07 — refund kept change: the small leftover
   *  the shop keeps when the cash handed back is short. Mirrors the
   *  server, which validates the legs against the refund value MINUS the
   *  kept amount (`TransactionRepository._resolveRefundKeptChange` →
   *  `validateRefundLegOverrideAmounts`). Omitted/null → unchanged. Only a
   *  SHORTFALL is ever kept, so handing back too much stays blocked. */
  kept?: { usd: number; lbp: number } | null,
): string | null {
  const lineTotals: Record<string, number> = {};
  for (const line of lines) {
    lineTotals[line.currencyCode] =
      (lineTotals[line.currencyCode] ?? 0) + line.amount;
  }

  const currencies = new Set([
    ...Object.keys(originalNet),
    ...Object.keys(lineTotals),
  ]);

  let originalNetValueUsd = 0;
  let chosenValue = 0;
  for (const currencyCode of currencies) {
    originalNetValueUsd += toUsd(
      originalNet[currencyCode] ?? 0,
      currencyCode,
      rate,
    );
    chosenValue += toUsd(lineTotals[currencyCode] ?? 0, currencyCode, rate);
  }
  const keptValue = kept
    ? toUsd(kept.usd, "USD", rate) + toUsd(kept.lbp, "LBP", rate)
    : 0;
  const originalValue = Math.abs(originalNetValueUsd) - keptValue;

  if (Math.abs(originalValue - chosenValue) > REFUND_VALUE_TOLERANCE_USD) {
    const fmt = (v: number) =>
      `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return `Return value at the current rate must equal ${fmt(originalValue)} (currently ${fmt(chosenValue)}).`;
  }
  return null;
}

/**
 * LIRA-272 — may the Transactions page's whole-transaction refund popup
 * offer kept change for this row? Only for a type the server allows (the
 * shared `REFUND_KEPT_CHANGE_TYPES`, rule 14) AND a refund that hands money
 * OUT of the shop: the refunded legs' net is money the customer paid IN, in
 * every currency it touches. The shared list includes FINANCIAL_SERVICE,
 * which also covers payout originals (an OMT/Whish RECEIVE): refunding one
 * takes money back FROM the customer, where "keeping" a shortfall would be
 * a loss — the server refuses it (`TransactionRepository.
 * _resolveRefundKeptChange`, "cannot keep change on a refund that takes
 * money back"). `legs` are the ORIGINAL's own legs (`row.payments`, IN
 * positive). Not for the session item refund popup, whose legs are the
 * money-back legs (OUT, negative) — that caller passes the type list alone.
 */
export function refundCanKeepChange(
  transactionType: string,
  legs: TransactionPaymentLeg[] | undefined,
): boolean {
  if (!REFUND_KEPT_CHANGE_TYPES.includes(transactionType)) return false;
  const live = Object.entries(netByCurrency(legs)).filter(
    ([currencyCode, amount]) => Math.abs(amount) > epsilonFor(currencyCode),
  );
  return live.length > 0 && live.every(([, amount]) => amount > 0);
}

/**
 * Owner decision 2026-10-07 — refund kept change, client-side mirror of the
 * server's own preconditions (`TransactionRepository._resolveRefundKeptChange`
 * stays the authority): every return line is DRAWER money — cash or a wallet
 * (OMT, WHISH, Binance, …), never a customer account or gift card — and
 * every line is in the refund's one currency. Returns why the kept change
 * cannot be booked, or null when it can (or when nothing is kept).
 *
 * `drawerMethodCodes` is the caller's drawer-affecting method list
 * (`usePaymentMethods().drawerAffectingMethods`, i.e. the DB's
 * `affects_drawer` flag — the same source the server's
 * `isDrawerAffectingMethod` reads), never a hard-coded second list here
 * (rule 14).
 */
export function validateRefundKeptChange(
  lines: RefundLegOverride[],
  refundCurrency: string,
  kept: { usd: number; lbp: number } | null,
  drawerMethodCodes: readonly string[],
): string | null {
  if (!kept || (kept.usd <= 0 && kept.lbp <= 0)) return null;
  if (lines.some((l) => !drawerMethodCodes.includes(l.method))) {
    return "Keeping change works only when the refund is handed back in cash or a wallet.";
  }
  if (lines.some((l) => l.currencyCode !== refundCurrency)) {
    return `Keeping change works only when the refund is handed back in ${refundCurrency}.`;
  }
  return null;
}

/**
 * LIRA-143 Phase 6b — the phone-refund UI's per-unit extra, riding alongside
 * `refundLegs` on the SAME `refundTransaction` call. Type alias for the core
 * schema's own `RefundUnitExtraInput` (`refundUnitExtraSchema`, rule 21) —
 * `@/api/backendApi`'s own `RefundUnitExtraOverride` is the SAME alias, so
 * the two are structurally (and nominally, via the shared source type)
 * identical rather than independently-drifting copies.
 */
export type RefundUnitExtraOverride = RefundUnitExtraInput;

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

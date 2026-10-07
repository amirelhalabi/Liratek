import { useMemo, useRef, useState } from "react";
import { CounterpartySettleModal, type PaymentLine } from "@liratek/ui";
import type { Money } from "@liratek/ui";
import {
  PAYOUT_KEEP_CHANGE_MAX,
  type RefundKeptChangeInput,
} from "@liratek/core";
import type { TransactionPaymentLeg } from "../cashFlow";
import {
  buildDefaultRefundLines,
  buildUnitExtras,
  linesMatchDefault,
  netByCurrency,
  toRefundLegs,
  validateRefundKeptChange,
  validateRefundValue,
  type RefundLegOverride,
  type RefundUnitExtraOverride,
  type UnitFlagState,
} from "../refundLegOverride";

/** A linked phone unit the refund UI can flag — LIRA-143 Phase 6b. Only the
 *  fields the modal actually renders; `ProductUnitDto` (@/api/backendApi)
 *  and `ProductUnit` (features/inventory/hooks/useProductUnits) both carry
 *  strictly more fields and are structurally assignable here. */
export interface RefundableUnit {
  id: number;
  imei: string;
}

/** LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §2 owner decision #3 / §4) — how much
 *  of a customer's outstanding session-basket account charge this refund
 *  cancels FIRST, before any drawer-affecting money is handed back. Both
 *  fields are non-negative; the modal shows whichever is non-zero (one or
 *  both currencies — a mixed-currency basket can reduce both at once). */
export interface AccountReductionInfo {
  usd: number;
  lbp: number;
  /** e.g. "amir" — the customer whose account balance drops. Falls back to
   *  a generic "the customer" when omitted. */
  clientLabel?: string;
}

export interface RefundMethodModalProps {
  /** The original transaction's structured customer-cash legs — `row.payments`
   *  (LIRA-064's `getRecent` field), NEVER `row.account_payments`
   *  (CUSTOMER_ACCOUNT never moves a drawer, so it is out of scope for a
   *  method-override return). May be empty when `units` is non-empty (a
   *  CUSTOMER_ACCOUNT-only phone sale with no drawer legs to override) —
   *  the caller falls back to the plain confirm()-based refund only when
   *  BOTH `legs` and `units` are empty. */
  legs: TransactionPaymentLeg[];
  /** Phase 6b — phone units linked to the sale being refunded
   *  (`productUnits.getForSaleItems`). Empty/omitted renders no "Returned
   *  phones" section at all, same as before this ticket. */
  units?: RefundableUnit[];
  /** LIRA-232 — when set, renders a read-only line ABOVE the payment lines
   *  ("Reduces amir's account by $1,500") showing how much of the customer's
   *  session-basket account charge this refund cancels first. Omitted (the
   *  default) renders no such line — every existing caller (LIRA-078/
   *  LIRA-231 POS + Transactions-page refunds, neither of which is
   *  session-account-aware) is unaffected. */
  accountReduction?: AccountReductionInfo;
  /** Active, drawer-affecting payment methods only (CUSTOMER_ACCOUNT/GIFT_CARD
   *  excluded) — usePaymentMethods().drawerAffectingMethods. */
  paymentMethods: Array<{ code: string; label: string }>;
  /**
   * LIRA-236 — the rate the popup OPENS with: the caller's `bookedRate`
   * (the sale's/transaction's own recorded rate, or the day's rate when
   * nothing was recorded — see `bookedRateSource`). No longer cosmetic: it
   * seeds MultiPaymentInput's own editable rate field
   * (`onExchangeRateChange`/`onRateChange`), which now drives BOTH the
   * account-reduction math upstream (via this modal's own `onRateChange`
   * prop below) and the value-based currency-mix matching that replaced the
   * old per-currency equality check (`validateRefundValue`,
   * refundLegOverride.ts). Falls back to MultiPaymentInput's own default
   * (89000) when the caller has nothing better, same as before.
   */
  exchangeRate: number;
  /** LIRA-236 — provenance of `exchangeRate` (the popup's default/booked
   *  rate). `"fallback"` renders a small note explaining that no rate was
   *  recorded for this sale/transaction and today's rate was used instead.
   *  Omitted renders no note (same as `"sale"`/`"transaction"`) — every
   *  caller that doesn't yet compute this is unaffected. */
  bookedRateSource?: "sale" | "transaction" | "fallback";
  /** LIRA-236 F15 — what kind of row the fallback note calls this ("No rate
   *  was recorded for this ___"). "sale" for the POS SaleDetailModal
   *  callers, "transaction" (the default) for the Transactions-page/generic
   *  callers — never hardcoded inside the note itself. */
  entityLabel?: "sale" | "transaction";
  /** LIRA-236 — fires whenever the operator EDITS the rate field (never on
   *  mount/prop-resync — mirrors MultiPaymentInput's own `onRateChange`).
   *  A session-refund caller uses this to debounce a re-preview at the new
   *  rate (account reduction + remainder legs). Omitted by a caller with
   *  nothing rate-dependent to re-fetch. */
  onRateChange?: (rate: number) => void;
  /** Owner decision 2026-10-07 — refund kept change: this refund may hand
   *  back a little less cash than owed (under $1 / 100,000 LBP, same
   *  currency, cash only) and the shop keeps the leftover as profit. The
   *  caller decides from the refunded row's type
   *  (`REFUND_KEPT_CHANGE_TYPES`, the server's own list) — and only a
   *  caller whose transport carries the kept amount may pass `true`.
   *  Default false: the exact amount is required, as before. */
  allowKeptChange?: boolean;
  isSubmitting?: boolean;
  onCancel: () => void;
  /**
   * `refundLegs === undefined` means the operator changed nothing from the
   * pre-filled default — the caller must call `refundTransaction(id)` with NO
   * override so an untouched confirm stays byte-identical to the
   * pre-LIRA-078 behavior (mirrors the original legs verbatim).
   *
   * `unitExtras` (Phase 6b) is passed as a SECOND argument only when at
   * least one linked unit was actually touched (`buildUnitExtras` returned
   * non-`undefined`) — when there is nothing to report, `onConfirm` is
   * called with just the one argument, so a caller/test that never passes
   * `units` sees the EXACT pre-Phase-6b call shape.
   *
   * `exchangeRate` (LIRA-236) is passed as a THIRD argument whenever
   * `refundLegs` is a real override (non-`undefined`) — the rate the popup
   * was showing at confirm time, so the server can validate the override's
   * TOTAL VALUE at that rate instead of the old per-currency rule. An
   * untouched confirm (`refundLegs === undefined`) never sends a rate
   * either, matching "today's default behaviour is unchanged".
   *
   * `keptChange` (owner decision 2026-10-07) is a FOURTH argument, passed
   * only when the shop keeps a leftover (always alongside a real
   * `refundLegs` override and the rate). Field names are the core schema's
   * (`refundKeptChangeSchema`).
   */
  onConfirm: (
    refundLegs: RefundLegOverride[] | undefined,
    unitExtras?: RefundUnitExtraOverride[],
    exchangeRate?: number,
    keptChange?: RefundKeptChangeInput,
  ) => void;
}

/**
 * LIRA-078 — refund tender-selection modal. Wraps the shared
 * `CounterpartySettleModal` + `MultiPaymentInput` (same pattern as the Debts
 * repayment modal) so the operator can choose which drawer(s)/method(s) a
 * refund pays back through, instead of the money always mirroring the
 * original payment legs.
 *
 * Money contract: MultiPaymentInput has no native read-only-amount mode, so
 * amounts are "validated-equal" instead of hard-locked — the Confirm button
 * is disabled until the chosen legs check out (mirroring the backend's own
 * hard-reject check, which remains the real authority).
 *
 * LIRA-236 — the check is now VALUE-based, at the popup's own (editable)
 * rate (`validateRefundValue`, refundLegOverride.ts), not per-currency
 * equality: any currency mix whose total value matches the refund is
 * accepted, replacing the original LIRA-078 "same currency, same amount"
 * rule.
 */
export function RefundMethodModal({
  legs,
  units = [],
  accountReduction,
  paymentMethods,
  exchangeRate,
  bookedRateSource,
  entityLabel = "transaction",
  onRateChange,
  allowKeptChange = false,
  isSubmitting = false,
  onCancel,
  onConfirm,
}: RefundMethodModalProps) {
  // Computed once from the legs snapshot the caller passed in when opening
  // this modal — stable for the lifetime of one refund attempt.
  const originalNet = useMemo(() => netByCurrency(legs), [legs]);
  const selectableMethodCodes = useMemo(
    () => paymentMethods.map((m) => m.code),
    [paymentMethods],
  );
  const defaults = useMemo(
    () => buildDefaultRefundLines(legs, selectableMethodCodes),
    [legs, selectableMethodCodes],
  );
  // Phase 6b: a sale refunded entirely on CUSTOMER_ACCOUNT has NO
  // drawer-affecting legs at all — `defaults` (and therefore the payment
  // section) is legitimately empty. Gate the MultiPaymentInput/"Returning"
  // rendering AND the confirm-disabled rule on this, so a units-only refund
  // (no legs, but linked phones to flag) can still be confirmed.
  const hasLegsToOverride = defaults.length > 0;
  // Owner decision 2026-10-07 — refund kept change needs a refund in ONE
  // currency (the server refuses a mixed one); MultiPaymentInput's payout
  // mode then reports the small shortfall it keeps.
  const keptEligible = allowKeptChange && defaults.length === 1;
  const refundCurrency = defaults[0]?.currencyCode ?? "USD";
  // The server's own cap (resolveKeptChange, payer "payout": kept must be
  // strictly LESS than it), in the refund's one currency — never hand-typed.
  const keptCapText =
    refundCurrency === "LBP"
      ? `${PAYOUT_KEEP_CHANGE_MAX.LBP.toLocaleString("en-US")} LBP`
      : `$${PAYOUT_KEEP_CHANGE_MAX.USD.toLocaleString("en-US")}`;

  const totals: Money[] = useMemo(
    () => defaults.map((d) => ({ currency: d.currencyCode, amount: d.amount })),
    [defaults],
  );
  const initialLines = useMemo(
    () =>
      defaults.map((d) => ({
        method: d.method,
        currencyCode: d.currencyCode,
        amount: d.amount,
      })),
    [defaults],
  );

  const [currentLines, setCurrentLines] = useState<PaymentLine[]>([]);
  const [unitFlags, setUnitFlags] = useState<Record<number, UnitFlagState>>({});
  // LIRA-236 — the popup's CURRENT rate, mirroring MultiPaymentInput's own
  // effective rate (seeded from `exchangeRate`, the caller's `bookedRate`;
  // kept in sync via `onExchangeRateChange` below, which MPI fires on mount,
  // on every user edit, AND whenever its own `exchangeRate` prop resyncs —
  // see MultiPaymentInput.tsx). Used for value-based matching and forwarded
  // on confirm.
  const [currentRate, setCurrentRate] = useState<number>(exchangeRate);
  // LIRA-236 F2 — true once the operator has GENUINELY edited the rate field
  // (mirrors MPI's own `onRateChange` contract: never fires on mount/prop
  // resync). A ref, not state: it only gates a value read inside
  // `handleConfirm`'s click handler, never something the render needs to
  // react to. Comparing `currentRate` against the caller's live `exchangeRate`
  // PROP instead would look reasonable but is NOT equivalent — the session
  // caller's own `bookedRate` state gets overwritten to match the typed rate
  // once the debounced re-preview resolves (`useSessionItemRefund.changeRate`
  // sets `bookedRate: rate`), which would silently resync the prop back to
  // `currentRate` and make a real edit look untouched again. This ref is
  // immune to that resync — it is set exactly once, the moment the operator
  // types, and nothing after can clear it.
  const rateWasTouchedRef = useRef(false);
  // What MultiPaymentInput (payout mode) reports the shop keeps — null when
  // the lines cover the refund, or the shortfall is not a small leftover.
  const [kept, setKept] = useState<{ usd: number; lbp: number } | null>(null);

  const overrideLines = toRefundLegs(currentLines);
  const reportedKept = keptEligible ? kept : null;
  // Payout mode reports ANY small shortfall, including a cross-currency
  // refund that is a cent or two short — which the value check has always
  // accepted (LIRA-236 tolerance). So the kept report is used only when it
  // is keepable (cash or wallet lines — `paymentMethods` is drawer-affecting
  // only — in the refund currency); otherwise the plain check decides, and
  // the method/currency reason shows only when that fails too.
  const keptError = validateRefundKeptChange(
    overrideLines,
    refundCurrency,
    reportedKept,
    selectableMethodCodes,
  );
  const activeKept = keptError == null ? reportedKept : null;
  const plainError = validateRefundValue(
    overrideLines,
    originalNet,
    currentRate,
    activeKept,
  );
  const validationError =
    plainError == null ? null : (keptError ?? plainError);
  const isDefault = linesMatchDefault(overrideLines, defaults);

  const methodLabel = (code: string): string =>
    paymentMethods.find((m) => m.code === code)?.label ?? code;

  const returningText = overrideLines
    .map((l) =>
      l.currencyCode === "USD"
        ? `$${l.amount.toLocaleString()} via ${methodLabel(l.method)}`
        : `${l.amount.toLocaleString()} LBP via ${methodLabel(l.method)}`,
    )
    .join(" + ");

  const setKeptFromMpi = (
    next: { usd: number; lbp: number } | null,
  ): void => {
    setKept(next ? { usd: next.usd, lbp: next.lbp } : null);
  };

  const getUnitFlag = (unitId: number): UnitFlagState =>
    unitFlags[unitId] ?? { isDefective: false, warrantyUntil: "" };

  const setUnitFlag = (unitId: number, patch: Partial<UnitFlagState>) => {
    setUnitFlags((prev) => ({
      ...prev,
      [unitId]: { ...getUnitFlag(unitId), ...patch },
    }));
  };

  const handleConfirm = () => {
    const finalLegs = isDefault ? undefined : overrideLines;
    const unitExtras = buildUnitExtras(
      units.map((u) => u.id),
      unitFlags,
    );
    // LIRA-236 — the rate rides alongside a REAL override (finalLegs
    // defined), matching "today's default behaviour is unchanged"
    // (REFUND_EXCHANGE_RATE_PLAN.md §3) for an untouched confirm. F2 fix
    // (round-2/final review, HIGH): it ALSO rides whenever the operator
    // genuinely typed a new rate, even when the resulting line set still
    // equals the (possibly re-previewed) default — e.g. a same-currency
    // single line, which a rate edit alone never changes, so `isDefault`
    // stays true. Omitting the rate there used to silently apply the
    // server's OLD booked rate instead of the one just typed. Only pass the
    // trailing argument(s) that are actually present — see the prop doc
    // comment for why this keeps a caller that supplies neither `units` nor
    // a touched rate seeing the EXACT pre-LIRA-236 call shape (rule 24's own
    // guard, "untouched default sends no override").
    const rateArg =
      finalLegs !== undefined || rateWasTouchedRef.current
        ? currentRate
        : undefined;
    const keptArg: RefundKeptChangeInput | undefined =
      finalLegs !== undefined &&
      activeKept &&
      (activeKept.usd > 0 || activeKept.lbp > 0)
        ? { kept_change_usd: activeKept.usd, kept_change_lbp: activeKept.lbp }
        : undefined;
    if (keptArg !== undefined) {
      onConfirm(finalLegs, unitExtras, rateArg, keptArg);
    } else if (rateArg !== undefined) {
      onConfirm(finalLegs, unitExtras, rateArg);
    } else if (unitExtras !== undefined) {
      onConfirm(finalLegs, unitExtras);
    } else {
      onConfirm(finalLegs);
    }
  };

  return (
    <CounterpartySettleModal
      title="Refund — Choose Return Method"
      subtitle={
        <span data-testid="refund-subtitle">
          {!hasLegsToOverride
            ? "A reversal entry will be created. Review the returned phone(s) below, then confirm."
            : keptEligible
              ? `A reversal entry will be created. Choose which drawer(s) the refund is handed back from, and adjust the rate if needed. Hand back what the customer originally paid — in cash or a wallet in ${refundCurrency} it may be short by less than ${keptCapText}, and the rest is kept as profit.`
              : "A reversal entry will be created. Choose which drawer(s) the refund is handed back from, and adjust the rate if needed — the total value at the rate shown must match what the customer originally paid."}
        </span>
      }
      onCancel={onCancel}
      onConfirm={handleConfirm}
      confirmLabel="Confirm Refund"
      confirmColor="red"
      isSubmitting={isSubmitting}
      confirmDisabled={
        validationError != null ||
        (hasLegsToOverride && overrideLines.length === 0)
      }
      multiPaymentInput={
        hasLegsToOverride
          ? {
              label: "Refund",
              currency: defaults[0]?.currencyCode ?? "USD",
              totalAmountCurrency: defaults[0]?.currencyCode ?? "USD",
              totals,
              initialLines,
              onChange: setCurrentLines,
              paymentMethods,
              currencies: [
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ],
              exchangeRate,
              // LIRA-236 — `onExchangeRateChange` mirrors MPI's effective
              // rate into `currentRate` unconditionally (fires on mount, on
              // every edit, and whenever MPI's own `exchangeRate` prop
              // resyncs); `onRateChange` fires ONLY on a genuine operator
              // edit (never on mount) and is the one forwarded to the
              // caller's own `onRateChange` prop, so a session-refund caller
              // re-previews only when the operator actually typed a new
              // rate, not once redundantly on open.
              onExchangeRateChange: setCurrentRate,
              onRateChange: (rate: number) => {
                rateWasTouchedRef.current = true;
                setCurrentRate(rate);
                onRateChange?.(rate);
              },
              showDiscount: false,
              showPmFee: false,
              // A refund's lines are money the shop hands BACK, not money
              // the customer paid (production test 2026-10-07).
              paidLabel: "Hand back",
              // Refund kept change — the shop hands money OUT, and only a
              // caller that may keep change wires the report (opt-in).
              ...(keptEligible
                ? { payer: "payout" as const, onKeptChange: setKeptFromMpi }
                : {}),
            }
          : undefined
      }
    >
      {bookedRateSource === "fallback" && (
        <div
          data-testid="refund-rate-fallback-note"
          className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-300"
        >
          No rate was recorded for this {entityLabel} — using today's rate.
        </div>
      )}
      {accountReduction &&
        (accountReduction.usd > 0 || accountReduction.lbp > 0) && (
          <div
            data-testid="refund-account-reduction"
            className="rounded-xl border border-sky-700/40 bg-sky-950/30 px-4 py-3 text-sm text-sky-200"
          >
            Reduces {accountReduction.clientLabel || "the customer"}'s account
            by{" "}
            {[
              accountReduction.usd > 0
                ? `$${accountReduction.usd.toLocaleString()}`
                : null,
              accountReduction.lbp > 0
                ? `${accountReduction.lbp.toLocaleString()} LBP`
                : null,
            ]
              .filter(Boolean)
              .join(" and ")}
          </div>
        )}
      {hasLegsToOverride && (
        <div
          data-testid="refund-return-summary"
          className="rounded-xl border border-slate-700/50 bg-slate-900/50 px-4 py-3 text-sm"
        >
          <span className="text-slate-400">Returning: </span>
          <span className="font-mono text-white">{returningText || "—"}</span>
          {validationError && (
            <p
              data-testid="refund-validation-error"
              className="mt-1 text-xs text-red-400"
            >
              {validationError}
            </p>
          )}
        </div>
      )}
      {units.length > 0 && (
        <div
          data-testid="refund-units-section"
          className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4 space-y-3"
        >
          <div>
            <h4 className="text-sm font-semibold text-white">
              Returned phones
            </h4>
            <p className="text-xs text-slate-400 mt-1">
              Leave a phone's warranty override empty to simply void its
              warranty along with this refund.
            </p>
          </div>
          {units.map((u) => {
            const flag = getUnitFlag(u.id);
            return (
              <div
                key={u.id}
                data-testid={`refund-unit-${u.id}`}
                className="flex flex-wrap items-center gap-3 bg-slate-950/50 rounded-lg px-3 py-2"
              >
                <span className="font-mono text-sm text-white">{u.imei}</span>
                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={flag.isDefective}
                    onChange={(e) =>
                      setUnitFlag(u.id, { isDefective: e.target.checked })
                    }
                    className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-700 accent-red-600"
                  />
                  Defective
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  New warranty expiry
                  <input
                    type="date"
                    value={flag.warrantyUntil}
                    onChange={(e) =>
                      setUnitFlag(u.id, { warrantyUntil: e.target.value })
                    }
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-red-500"
                  />
                </label>
              </div>
            );
          })}
        </div>
      )}
    </CounterpartySettleModal>
  );
}

export default RefundMethodModal;

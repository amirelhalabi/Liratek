import { useMemo, useState } from "react";
import { CounterpartySettleModal, type PaymentLine } from "@liratek/ui";
import type { Money } from "@liratek/ui";
import type { TransactionPaymentLeg } from "../cashFlow";
import {
  buildDefaultRefundLines,
  buildUnitExtras,
  linesMatchDefault,
  netByCurrency,
  validateRefundLines,
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
  /** Active, drawer-affecting payment methods only (CUSTOMER_ACCOUNT/GIFT_CARD
   *  excluded) — usePaymentMethods().drawerAffectingMethods. */
  paymentMethods: Array<{ code: string; label: string }>;
  /** Purely cosmetic — a same-currency method override never converts
   *  cross-currency, so this only feeds MultiPaymentInput's header display.
   *  Pass a real rate when available; falls back to MultiPaymentInput's own
   *  default (89000) otherwise. */
  exchangeRate: number;
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
   */
  onConfirm: (
    refundLegs: RefundLegOverride[] | undefined,
    unitExtras?: RefundUnitExtraOverride[],
  ) => void;
}

/** method+currencyCode+amount only — MultiPaymentInput's PaymentLine also
 *  carries an `id`/`direction`/`voucherCode` this modal never uses. */
function toOverride(lines: PaymentLine[]): RefundLegOverride[] {
  return lines
    .filter((l) => l.amount > 0)
    .map((l) => ({
      method: l.method,
      currencyCode: l.currencyCode,
      amount: l.amount,
    }));
}

/**
 * LIRA-078 — refund tender-selection modal. Wraps the shared
 * `CounterpartySettleModal` + `MultiPaymentInput` (same pattern as the Debts
 * repayment modal) so the operator can choose which drawer(s)/method(s) a
 * refund pays back through, instead of the money always mirroring the
 * original payment legs.
 *
 * Money contract (method-override ONLY, per currency): MultiPaymentInput has
 * no native read-only-amount mode, so amounts are "validated-equal" instead
 * of hard-locked — the Confirm button is disabled until every currency's
 * chosen total matches the original exactly (mirroring the backend's own
 * hard-reject check, which remains the real authority).
 */
export function RefundMethodModal({
  legs,
  units = [],
  paymentMethods,
  exchangeRate,
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

  const overrideLines = toOverride(currentLines);
  const validationError = validateRefundLines(overrideLines, originalNet);
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
    // Only pass the second argument when there is something to report —
    // see the prop doc comment for why this keeps a `units`-less caller's
    // `onConfirm` call shape byte-identical to pre-Phase-6b.
    if (unitExtras !== undefined) {
      onConfirm(finalLegs, unitExtras);
    } else {
      onConfirm(finalLegs);
    }
  };

  return (
    <CounterpartySettleModal
      title="Refund — Choose Return Method"
      subtitle={
        hasLegsToOverride
          ? "A reversal entry will be created. Choose which drawer(s) the refund pays back through — the return total per currency must match what the customer originally paid."
          : "A reversal entry will be created. Review the returned phone(s) below, then confirm."
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
              showDiscount: false,
              showPmFee: false,
            }
          : undefined
      }
    >
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

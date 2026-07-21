import { useMemo, useState } from "react";
import { CounterpartySettleModal, type PaymentLine } from "@liratek/ui";
import type { Money } from "@liratek/ui";
import type { TransactionPaymentLeg } from "../cashFlow";
import {
  buildDefaultRefundLines,
  linesMatchDefault,
  netByCurrency,
  validateRefundLines,
  type RefundLegOverride,
} from "../refundLegOverride";

export interface RefundMethodModalProps {
  /** The original transaction's structured customer-cash legs — `row.payments`
   *  (LIRA-064's `getRecent` field), NEVER `row.account_payments`
   *  (CUSTOMER_ACCOUNT never moves a drawer, so it is out of scope for a
   *  method-override return). Must be non-empty — the caller falls back to
   *  the plain confirm()-based refund when there is nothing to override. */
  legs: TransactionPaymentLeg[];
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
   */
  onConfirm: (refundLegs: RefundLegOverride[] | undefined) => void;
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
  paymentMethods,
  exchangeRate,
  isSubmitting = false,
  onCancel,
  onConfirm,
}: RefundMethodModalProps) {
  // Computed once from the legs snapshot the caller passed in when opening
  // this modal — stable for the lifetime of one refund attempt.
  const originalNet = useMemo(() => netByCurrency(legs), [legs]);
  const defaults = useMemo(() => buildDefaultRefundLines(legs), [legs]);

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

  return (
    <CounterpartySettleModal
      title="Refund — Choose Return Method"
      subtitle="A reversal entry will be created. Choose which drawer(s) the refund pays back through — the return total per currency must match what the customer originally paid."
      onCancel={onCancel}
      onConfirm={() => onConfirm(isDefault ? undefined : overrideLines)}
      confirmLabel="Confirm Refund"
      confirmColor="red"
      isSubmitting={isSubmitting}
      confirmDisabled={validationError != null || overrideLines.length === 0}
      multiPaymentInput={{
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
      }}
    >
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
    </CounterpartySettleModal>
  );
}

export default RefundMethodModal;

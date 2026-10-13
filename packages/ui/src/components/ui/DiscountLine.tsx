/**
 * DiscountLine — the one "lower what is owed" line of the payment form
 * (owner 2026-10-13, LIRA-318). MultiPaymentInput renders it for its own
 * discount; pages that keep their own discount state (POS / Maintenance
 * checkout, Debts and Partners settle) render it through MultiPaymentInput's
 * `discountRow` slot, so every page shows the same line in the same place:
 * under "Total Amount", inside the payment box.
 *
 * Layout only — no money logic. The caller owns the value, the cap and the
 * payload; this component draws the label, the field(s), the
 * "Capped to max" note and an optional reason field.
 */

import type { ReactNode } from "react";

export interface DiscountLineProps {
  /** "Discount" (a price cut) or "Forgive (no cash)" (a debt cut). */
  label: string;
  /** The field(s): one per currency, built with {@link discountFieldClass}. */
  children: ReactNode;
  /** Shown in red beside the field(s) when a typed value was cut to the
   *  limit, e.g. "Capped to max ($2.00)". Omit when under the limit. */
  capNote?: string | undefined;
  /** Optional reason field, shown under the line. */
  reason?:
    | {
        value: string;
        onChange: (value: string) => void;
        placeholder?: string | undefined;
        testId?: string | undefined;
      }
    | undefined;
  /** Small hint under the line (e.g. what is left to forgive). */
  hint?: ReactNode | undefined;
  testId?: string | undefined;
}

/** Shared styling for a DiscountLine input (`over` = typed above the cap). */
export function discountFieldClass(over: boolean): string {
  return `w-24 bg-emerald-950/30 border rounded-md px-2 py-1 text-emerald-200 text-xs font-mono text-right focus:outline-none focus:border-emerald-500 transition-colors ${
    over ? "border-red-500" : "border-emerald-700/40"
  }`;
}

export function DiscountLine({
  label,
  children,
  capNote,
  reason,
  hint,
  testId,
}: DiscountLineProps) {
  return (
    <div data-testid={testId} className="py-1 space-y-1">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-emerald-400 font-medium">{label}</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {children}
          {capNote && (
            <span
              data-testid="discount-cap-note"
              className="text-[11px] text-red-400"
            >
              {capNote}
            </span>
          )}
        </div>
      </div>
      {reason && (
        <input
          type="text"
          data-testid={reason.testId}
          aria-label={`${label} reason`}
          value={reason.value}
          onChange={(e) => reason.onChange(e.target.value)}
          placeholder={reason.placeholder ?? "Reason (optional)"}
          className="w-full bg-emerald-950/20 border border-emerald-700/30 rounded-md px-2 py-1 text-emerald-100 text-[11px] focus:outline-none focus:border-emerald-500 placeholder:text-emerald-400/40"
        />
      )}
      {hint && <div className="text-[11px] text-emerald-400/70">{hint}</div>}
    </div>
  );
}

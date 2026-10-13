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
 *
 * LIRA-319 (owner 2026-10-13) — the same line can instead ADD an extra
 * charge: with `allowExtra` it shows a "− Discount | + Extra" switch. The
 * page owns which side is active (`mode`) and clears the other amount when
 * the switch is tapped (a sale has a discount OR an extra, never both).
 */

import type { ReactNode } from "react";

/** Which side of the line is active: lower what is owed, or add to it. */
export type DiscountLineMode = "discount" | "extra";

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
  /** LIRA-319 — active side of the switch. Absent = no switch (the line is
   *  a plain discount, today's behaviour). */
  mode?: DiscountLineMode | undefined;
  /** LIRA-319 — the switch was tapped. The page clears the other amount. */
  onModeChange?: ((mode: DiscountLineMode) => void) | undefined;
  /** LIRA-319 — show the "− Discount | + Extra" switch. Pages that may not
   *  take an extra (payouts, settles, partner sales, session-basket items)
   *  leave it off. */
  allowExtra?: boolean | undefined;
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
  mode,
  onModeChange,
  allowExtra = false,
}: DiscountLineProps) {
  const showSwitch = allowExtra && mode !== undefined && !!onModeChange;
  const isExtra = showSwitch && mode === "extra";
  const shownLabel = isExtra ? "Extra" : label;
  const switchButton = (m: DiscountLineMode, text: string) => (
    <button
      type="button"
      data-testid={`discount-mode-${m}`}
      aria-pressed={mode === m}
      onClick={() => {
        if (mode !== m) onModeChange?.(m);
      }}
      className={`px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
        mode === m
          ? m === "extra"
            ? "bg-amber-500/25 text-amber-200"
            : "bg-emerald-500/25 text-emerald-200"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {text}
    </button>
  );
  return (
    <div data-testid={testId} className="py-1 space-y-1">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {showSwitch ? (
          <span className="flex items-center gap-1.5">
            <span
              role="group"
              aria-label="Discount or extra"
              className="inline-flex rounded-md border border-slate-600/60 overflow-hidden"
            >
              {switchButton("discount", "− Discount")}
              {switchButton("extra", "+ Extra")}
            </span>
            <span
              className={`text-xs font-medium ${
                isExtra ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {shownLabel}
            </span>
          </span>
        ) : (
          // No switch: the exact pre-LIRA-319 markup (label beside the field).
          <span className="text-xs text-emerald-400 font-medium">{label}</span>
        )}
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
          aria-label={`${shownLabel} reason`}
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

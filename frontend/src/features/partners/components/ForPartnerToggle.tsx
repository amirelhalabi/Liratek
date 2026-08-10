import type { ReactNode } from "react";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";

/**
 * ForPartnerToggle (CQ-6) — the "For Partner" checkbox + PartnerSelector
 * block, shared by the 7 hand-rolled copies it replaces: CheckoutModal
 * (POS), TelecomForm, FinancialForm, OmtWhishAppTransferForm, CryptoForm,
 * KatchForm (recharge), and Loto. Every copy wired the SAME two lines of
 * logic (flip `forPartner`, clear the selected partner on uncheck) around
 * the SAME `<PartnerSelector required .../>` — that wiring is what this
 * component owns.
 *
 * Presentation only: no `window.api`/`useApi()` here (PartnerSelector itself
 * owns the partner list fetch). Each call site keeps its OWN `forPartner`/
 * `selectedPartnerId` state, its own submit-guard logic, and its own OUTER
 * layout wrapper (a bordered box, a flex toolbar row, a bare `<div>`, ...) —
 * only the checkbox+label+PartnerSelector innards are consolidated here.
 *
 * The 7 sites diverge slightly in exact styling (accent color, label size,
 * whether the selector stacks below via `mt-2` or sits inline in a flex
 * row). Every class name is overridable; the defaults reproduce the
 * majority pattern (orange accent, `text-xs text-slate-400` label, `mt-2`
 * selector spacing) so most call sites need zero overrides.
 */

const DEFAULT_LABEL_WRAP_CLASS =
  "flex items-center gap-2 cursor-pointer select-none";
const DEFAULT_TEXT_CLASS = "text-xs text-slate-400";
const DEFAULT_CHECKBOX_CLASS =
  "w-4 h-4 rounded border-slate-600 bg-slate-900 text-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500";
const DEFAULT_SELECTOR_CLASS = "mt-2";

export interface ForPartnerToggleProps {
  /** Checkbox checked state — owned by the caller. */
  checked: boolean;
  /** Called with the new checked value. Unchecking ALSO clears the partner
   *  selection (calls `onPartnerChange(null)`) — every existing call site
   *  did this inline; consolidating it here removes 7 copies of the same
   *  2-line handler. */
  onChange: (checked: boolean) => void;
  selectedPartnerId: number | null;
  onPartnerChange: (partnerId: number | null) => void;
  /** data-testid for the checkbox `<input>` — each call site keeps its own
   *  existing id (e.g. "checkout-for-partner-toggle",
   *  "katch-for-partner-toggle") so existing e2e/unit-test selectors keep
   *  matching verbatim. */
  testId: string;
  /** Label text next to the checkbox. Default "For Partner". */
  label?: ReactNode;
  /** @deprecated LIRA-118: forwarded to PartnerSelector, which now no-ops
   *  on it — the single-partner branch there always self-selects
   *  unconditionally (a displayed "Partner: {name}" with no dropdown must
   *  be a real selection). Previously only the 5 recharge forms passed
   *  this; CheckoutModal/Loto/Exchange/CustomServices omitted it and were
   *  each left permanently unsubmittable for a shop with exactly one
   *  partner until the PartnerSelector fix. Kept accepted here purely so
   *  the 5 forms that still pass it don't need edits. */
  autoSelectSingle?: boolean;
  /** Forwarded to PartnerSelector — restrict to a system association. */
  systemFilter?: string;
  /** className for the `<label>` wrapper (checkbox + text). */
  labelClassName?: string;
  /** className for the checkbox `<input>` — override for a non-orange
   *  accent (CheckoutModal uses violet, CryptoForm uses amber). */
  checkboxClassName?: string;
  /** className for the text next to the checkbox. */
  textClassName?: string;
  /** className passed to PartnerSelector. Default "mt-2" (stacks below the
   *  checkbox); pass "" for an inline flex-row layout (e.g. Katch/Financial,
   *  which render the selector as a sibling flex item, not stacked). */
  selectorClassName?: string;
}

export function ForPartnerToggle({
  checked,
  onChange,
  selectedPartnerId,
  onPartnerChange,
  testId,
  label = "For Partner",
  autoSelectSingle,
  systemFilter,
  labelClassName = DEFAULT_LABEL_WRAP_CLASS,
  checkboxClassName = DEFAULT_CHECKBOX_CLASS,
  textClassName = DEFAULT_TEXT_CLASS,
  selectorClassName = DEFAULT_SELECTOR_CLASS,
}: ForPartnerToggleProps) {
  return (
    <>
      <label className={labelClassName}>
        <input
          type="checkbox"
          data-testid={testId}
          checked={checked}
          onChange={(e) => {
            const next = e.target.checked;
            onChange(next);
            if (!next) onPartnerChange(null);
          }}
          className={checkboxClassName}
        />
        <span className={textClassName}>{label}</span>
      </label>
      {checked && (
        <PartnerSelector
          required
          {...(autoSelectSingle !== undefined ? { autoSelectSingle } : {})}
          {...(systemFilter !== undefined ? { systemFilter } : {})}
          selectedPartnerId={selectedPartnerId}
          onSelect={onPartnerChange}
          className={selectorClassName}
        />
      )}
    </>
  );
}

const DEFAULT_NOTICE_CLASS =
  "text-sm text-orange-200 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-4";

export interface ForPartnerNoticeProps {
  /** data-testid for the notice `<div>` — kept per-site (e.g.
   *  "checkout-partner-no-payment-notice"). */
  testId: string;
  /** The message content — fully owned by the caller (amounts/currency/
   *  wording differ per flow: a sale, a recharge, a ticket, a transfer). */
  children: ReactNode;
  /** className override for the notice box. Default matches the majority
   *  pattern (orange, rounded-xl, px-4 py-4); override for a different
   *  accent color (CheckoutModal: violet) or sizing (Katch: compact). */
  className?: string;
}

/** The "no counter payment is collected" notice box shown in place of the
 * payment/amount section once "For Partner" is toggled on. Rendered
 * separately from `<ForPartnerToggle>` because on every call site the
 * notice sits in a DIFFERENT part of the layout than the checkbox (e.g.
 * CheckoutModal: checkbox in the left cart column, notice replacing the
 * MultiPaymentInput in the right payment column) — there is no single DOM
 * insertion point that fits all 7 sites simultaneously.
 */
export function ForPartnerNotice({
  testId,
  children,
  className = DEFAULT_NOTICE_CLASS,
}: ForPartnerNoticeProps) {
  return (
    <div data-testid={testId} className={className}>
      {children}
    </div>
  );
}

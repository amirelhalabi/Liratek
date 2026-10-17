import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Handshake, Info } from "lucide-react";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";

/**
 * ForPartnerToggle (CQ-6) — the "For Partner" toggle button + PartnerSelector
 * block, shared by every money form that can book a sale to a partner:
 * CheckoutModal (POS), TelecomForm, FinancialForm, OmtWhishAppTransferForm,
 * CryptoForm, KatshForm (recharge), Loto, Exchange and Services. Every site
 * wired the SAME two lines of logic (flip `forPartner`, clear the selected
 * partner on turning it off) around the SAME `<PartnerSelector required/>` —
 * that wiring is what this component owns.
 *
 * Owner decision 2026-10-16: it is a toggle BUTTON (not a checkbox), the
 * same height and shape as the toolbar controls it sits next to. It keeps
 * `role="checkbox"` + `aria-checked`, so `toBeChecked()` and Playwright's
 * `.check()`/`.uncheck()` keep working, and its accessible name is the
 * label text ("For Partner").
 *
 * Presentation only: no `window.api`/`useApi()` here (PartnerSelector itself
 * owns the partner list fetch). Each call site keeps its OWN `forPartner`/
 * `selectedPartnerId` state, its own submit-guard logic, and its own OUTER
 * layout wrapper.
 *
 * Styling: OFF is a neutral outline; ON fills with `activeClassName`. The
 * two class sets never overlap — index.css re-asserts the slate classes with
 * `!important` for light mode, so a slate class left on the ON state would
 * paint over the fill. Every class passed in must be a literal string
 * (Tailwind only generates classes it can see written out).
 */

const BASE_CLASS =
  "inline-flex items-center gap-2 h-10 px-3 shrink-0 whitespace-nowrap rounded-lg border text-sm font-semibold transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60";
const OFF_CLASS =
  "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white";
/** ON fill when the caller gives none — the app's default orange accent. */
const DEFAULT_ACTIVE_CLASS = "bg-orange-500 text-white";
const DEFAULT_SELECTOR_CLASS = "mt-2";

export interface ForPartnerToggleProps {
  /** On/off state — owned by the caller. */
  checked: boolean;
  /** Called with the new value. Turning it off ALSO clears the partner
   *  selection (calls `onPartnerChange(null)`). */
  onChange: (checked: boolean) => void;
  selectedPartnerId: number | null;
  onPartnerChange: (partnerId: number | null) => void;
  /** data-testid for the toggle button — each call site keeps its own
   *  existing id (e.g. "checkout-for-partner-toggle",
   *  "katsh-for-partner-toggle") so existing e2e/unit-test selectors keep
   *  matching verbatim. */
  testId: string;
  /** Button label. Default "For Partner". */
  label?: ReactNode;
  /** Classes for the ON fill (background + label colour), as one literal
   *  string — e.g. `PROVIDER_BRANDS.WHISH.solid` on a recharge form, or
   *  "bg-violet-600 text-white" on POS. Default: orange. */
  activeClassName?: string | undefined;
  /** @deprecated LIRA-118: forwarded to PartnerSelector, which now no-ops
   *  on it — the single-partner branch there always self-selects. */
  autoSelectSingle?: boolean;
  /** Forwarded to PartnerSelector — restrict to a system association. */
  systemFilter?: string;
  /** className passed to PartnerSelector. Default "mt-2" (stacks below the
   *  button); pass "" for an inline flex-row layout. */
  selectorClassName?: string;
  /** Render the PartnerSelector after the button when on. Default true.
   *  Pass false when the caller places its own `<PartnerSelector>`
   *  elsewhere in the layout. */
  showSelector?: boolean;
}

export function ForPartnerToggle({
  checked,
  onChange,
  selectedPartnerId,
  onPartnerChange,
  testId,
  label,
  activeClassName = DEFAULT_ACTIVE_CLASS,
  autoSelectSingle,
  systemFilter,
  selectorClassName = DEFAULT_SELECTOR_CLASS,
  showSelector = true,
}: ForPartnerToggleProps) {
  const { t } = useTranslation("partners");
  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-testid={testId}
        onClick={() => {
          const next = !checked;
          onChange(next);
          if (!next) onPartnerChange(null);
        }}
        className={`${BASE_CLASS} ${
          checked ? `border-transparent shadow ${activeClassName}` : OFF_CLASS
        }`}
      >
        <Handshake className="w-4 h-4" aria-hidden="true" />
        <span>{label ?? t("toggle.forPartner")}</span>
        {checked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
      </button>
      {checked && showSelector && (
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

/**
 * Notice colours per tone, readable in BOTH themes: dark text on a light
 * tint in light mode, the pale text on a 10 % tint only under `dark:`
 * (owner report 2026-10-16 — pale orange on pale orange was unreadable in
 * light mode). Same pattern as the Dashboard's warning banners. Literal
 * strings on purpose (Tailwind only generates classes it can see).
 */
const NOTICE_TONES = {
  orange:
    "bg-orange-50 border-orange-300 text-orange-900 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-200",
  violet:
    "bg-violet-50 border-violet-300 text-violet-900 dark:bg-violet-500/10 dark:border-violet-500/30 dark:text-violet-200",
  teal: "bg-teal-50 border-teal-300 text-teal-900 dark:bg-teal-500/10 dark:border-teal-500/30 dark:text-teal-200",
  rose: "bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-200",
  sky: "bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-200",
} as const;

const NOTICE_ICON_TONES = {
  orange: "text-orange-600 dark:text-orange-400",
  violet: "text-violet-600 dark:text-violet-400",
  teal: "text-teal-600 dark:text-teal-400",
  rose: "text-rose-600 dark:text-rose-400",
  sky: "text-sky-600 dark:text-sky-400",
} as const;

export type ForPartnerNoticeTone = keyof typeof NOTICE_TONES;

export interface ForPartnerNoticeProps {
  /** data-testid for the notice `<div>` — kept per-site (e.g.
   *  "checkout-partner-no-payment-notice"). */
  testId: string;
  /** The message content — fully owned by the caller (amounts/currency/
   *  wording differ per flow: a sale, a recharge, a ticket, a transfer). */
  children: ReactNode;
  /** Colour family. Default "orange". */
  tone?: ForPartnerNoticeTone;
  /** Extra layout classes for the box (width, margins). Colours come from
   *  `tone` — do not pass text/background colours here. */
  className?: string;
  /** Extra layout classes for the content next to the icon (e.g. a flex
   *  row when the notice also holds a control). */
  contentClassName?: string;
}

/** The "nothing is collected now" notice shown in place of the
 * payment/amount section once "For Partner" is turned on. Rendered
 * separately from `<ForPartnerToggle>` because on every call site the
 * notice sits in a DIFFERENT part of the layout than the toggle (e.g.
 * CheckoutModal: toggle in the left cart column, notice replacing the
 * MultiPaymentInput in the right payment column).
 */
export function ForPartnerNotice({
  testId,
  children,
  tone = "orange",
  className = "",
  contentClassName = "",
}: ForPartnerNoticeProps) {
  return (
    <div
      data-testid={testId}
      className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${NOTICE_TONES[tone]} ${className}`}
    >
      <Info
        className={`w-4 h-4 mt-0.5 shrink-0 ${NOTICE_ICON_TONES[tone]}`}
        aria-hidden="true"
      />
      <div className={`flex-1 min-w-0 ${contentClassName}`}>{children}</div>
    </div>
  );
}

import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import MultiPaymentInput from "./MultiPaymentInput";
import type { MultiPaymentInputProps } from "./MultiPaymentInput";

/**
 * CounterpartySettleModal (CQ-11, extends CQ-6's `<ForPartnerToggle>` family)
 *
 * ONE settlement-form shell shared by the three counterparty pages (Debts,
 * Suppliers, Partners) — and the D5 batch-settle confirm step in Suppliers.
 * Each page renders wildly different SURROUNDING content (balance cards,
 * direction toggles, dual-currency due) and owns its OWN submit/transport
 * logic; what's identical everywhere is the LAYOUT: an optional lead-in,
 * MultiPaymentInput legs, an optional discount row, optional extra fields
 * (note / TransactionTimeOverride / hints), then a Cancel/Confirm footer.
 *
 * This component is presentation + local layout only — it never calls
 * `window.api` / `useApi()` and has no opinion on what "settling" means for
 * a given counterparty kind. The page always owns:
 *   - configuring `multiPaymentInput` (totals, currency, methods, discount)
 *   - `discountSlot` / `children` content (note fields, time override, …)
 *   - the `onConfirm` handler (the actual IPC/REST call)
 *
 * Two variants:
 *   - "modal" (default): full backdrop + card, title bar with close (X),
 *     Cancel/Confirm footer. Used by Debts' repayment modal, Partners'
 *     Settle modal, and the new Suppliers batch-settle confirm step.
 *   - "inline": just the content, no backdrop/title bar — for a page that
 *     embeds the form directly in a tab (Suppliers' Pay/Receive section).
 *     `onCancel` is typically omitted here (a single Confirm action).
 */

export type CounterpartySettleConfirmColor =
  | "emerald"
  | "red"
  | "green"
  | "violet"
  | "orange"
  | "blue";

const CONFIRM_COLOR_CLASSES: Record<CounterpartySettleConfirmColor, string> = {
  emerald: "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20",
  red: "bg-red-600 hover:bg-red-500 shadow-red-900/20",
  green: "bg-green-600 hover:bg-green-500 shadow-green-900/20",
  violet: "bg-violet-600 hover:bg-violet-500 shadow-violet-900/20",
  orange: "bg-orange-600 hover:bg-orange-500 shadow-orange-900/20",
  blue: "bg-blue-600 hover:bg-blue-500 shadow-blue-900/20",
};

export interface CounterpartySettleModalProps {
  /** Default "modal". */
  variant?: "modal" | "inline";
  /** Header title (modal: shown in the title bar next to the close button;
   *  inline: rendered as a small section label above `beforeContent` when
   *  provided — omit to render no heading at all). */
  title?: string;
  /** Small text under the title. */
  subtitle?: ReactNode;
  /** Rendered above the MultiPaymentInput — balance cards, direction toggle,
   *  currency picker, mode header. Fully owned by the page. */
  beforeContent?: ReactNode;
  /** The MultiPaymentInput prop bag, spread verbatim onto
   *  `<MultiPaymentInput {...multiPaymentInput} />`. Every MPI prop (totals,
   *  currency, paymentMethods, showDiscount, onChange, onReturnChange,
   *  onKeptChange, ...) is the page's to configure — this component does not
   *  interpret or override any of them. Omit (or pass `null`/`undefined`) to
   *  skip rendering MPI entirely — e.g. Partners' CLIENT_ACCOUNT settle mode,
   *  which moves no cash and has no legs to speak of. */
  multiPaymentInput?: MultiPaymentInputProps | null | undefined;
  /** Forces MultiPaymentInput to remount (fresh internal state) when it
   *  changes — the React `key` for the inner element. Spreading props never
   *  sets `key` (React reserves it), so a page that stays mounted between
   *  submits (Suppliers' inline Pay/Receive form, which resets by bumping a
   *  counter instead of unmounting the whole section) needs this explicit
   *  passthrough. Pages that unmount the whole modal between opens (Debts,
   *  Partners) don't need it. */
  multiPaymentInputKey?: string | number;
  /** Custom discount UI rendered directly after the MultiPaymentInput — e.g.
   *  Debts' dual-currency Discount/Forgive row, Partners' capped
   *  single-currency row. Omit when the page relies on MultiPaymentInput's
   *  OWN built-in discount (`showDiscount`/`maxDiscount` inside
   *  `multiPaymentInput`) — e.g. Suppliers' Pay/Receive form. */
  discountSlot?: ReactNode;
  /** Anything else — note field, TransactionTimeOverride, a reason input
   *  tied to MPI's own discount, informational hints. Rendered after the
   *  discount slot, before the footer. */
  children?: ReactNode;
  /** Footer. `onCancel` is optional — omit for a single-button footer
   *  (Suppliers' inline Pay/Receive "Record Payment" action). */
  onCancel?: () => void;
  cancelLabel?: string;
  onConfirm: () => void;
  confirmLabel: string;
  isSubmitting?: boolean;
  confirmDisabled?: boolean;
  /** Tailwind color accent for the confirm button. Default "emerald". */
  confirmColor?: CounterpartySettleConfirmColor;
  /** Extra classes merged onto the modal panel (e.g. a wider `max-w-xl` for
   *  a form with more fields). Ignored for `variant="inline"`. */
  panelClassName?: string;
  /** Show a close (X) icon button in the header next to the title (modal
   *  variant only), in addition to the footer Cancel button — Partners'
   *  existing `Modal` shell convention. Default false: Debts/Suppliers never
   *  had one — backdrop-click + footer Cancel are the only close paths. */
  showCloseButton?: boolean;
}

export function CounterpartySettleModal({
  variant = "modal",
  title,
  subtitle,
  beforeContent,
  multiPaymentInput,
  multiPaymentInputKey,
  discountSlot,
  children,
  onCancel,
  cancelLabel = "Cancel",
  onConfirm,
  confirmLabel,
  isSubmitting = false,
  confirmDisabled = false,
  confirmColor = "emerald",
  panelClassName = "max-w-xl",
  showCloseButton = false,
}: CounterpartySettleModalProps) {
  const isModal = variant === "modal";

  // Fix Electron/Windows focus bug: nudge window focus when the modal closes
  // (mirrors ConfirmModal / TopUpModal — inert for the inline variant, which
  // never unmounts the same way a backdrop modal does).
  useEffect(() => {
    if (!isModal) return;
    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;
    return () => {
      try {
        (
          window as { api?: { display?: { fixFocus?: () => void } } }
        ).api?.display?.fixFocus?.();
      } catch {
        /* ignore */
      }
    };
  }, [isModal]);

  const body = (
    <div className="space-y-4" data-testid="counterparty-settle-body">
      {beforeContent}
      {multiPaymentInput && (
        <MultiPaymentInput key={multiPaymentInputKey} {...multiPaymentInput} />
      )}
      {discountSlot}
      {children}
      <div className={isModal ? "pt-2 flex gap-3" : "flex justify-end gap-3"}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className={
              isModal
                ? "flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
                : "px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors font-medium text-sm disabled:opacity-50"
            }
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting || confirmDisabled}
          className={
            isModal
              ? `${onCancel ? "flex-1" : "w-full"} py-3 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none ${CONFIRM_COLOR_CLASSES[confirmColor]}`
              : `px-6 py-2.5 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${CONFIRM_COLOR_CLASSES[confirmColor]}`
          }
        >
          {isSubmitting ? "Processing..." : confirmLabel}
        </button>
      </div>
    </div>
  );

  if (!isModal) {
    return (
      <div data-testid="counterparty-settle-inline">
        {title && (
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
            {title}
          </h3>
        )}
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
      data-testid="counterparty-settle-modal"
    >
      <div
        className={`bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full shadow-2xl overflow-hidden ${panelClassName}`}
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            {title && <h3 className="text-xl font-bold text-white">{title}</h3>}
            {subtitle && (
              <div className="text-xs text-slate-400 mt-1">{subtitle}</div>
            )}
          </div>
          {showCloseButton && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-slate-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        {body}
      </div>
    </div>
  );
}

export default CounterpartySettleModal;

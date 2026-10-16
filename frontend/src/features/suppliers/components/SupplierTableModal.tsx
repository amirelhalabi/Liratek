import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";

export interface SupplierTableModalProps {
  /** e.g. "Katsh — Transactions" — also the dialog's accessible name. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Owner request (2026-10-16) — the selected supplier's Transactions history
 * and Payments ledger each open in their own window instead of stacking on
 * the page. Same shell as the app's other modals (`ReceiptPreviewModal`,
 * this page's Add Credit / Debt): black/80 backdrop, slate-900 card, header
 * with an X. Only wider (the tables are) and with its body scrolling.
 * Escape, the X and a click on the backdrop all close it. The caller runs
 * `useModalFocusFix(open)`, like this page's other modals.
 */
export function SupplierTableModal({
  title,
  onClose,
  children,
}: SupplierTableModalProps) {
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="supplier-table-modal-backdrop"
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
          <h2 id={titleId} className="text-xl font-bold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

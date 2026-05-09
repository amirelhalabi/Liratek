import { useEffect, useState } from "react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

interface PaymentMethod {
  code: string;
  label: string;
}

interface SummaryLine {
  label: string;
  value: string;
  color?: string;
}

export interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
  /** Title shown in the sheet header */
  title?: string;
  /** Subtitle / description */
  subtitle?: string;
  /** Accent color for the confirm button */
  accentColor?: string;
  /** Custom confirm button text */
  confirmLabel?: string;
  /** Summary lines to display at the top */
  summary?: SummaryLine[];
  /** MultiPaymentInput props */
  totalAmount: number;
  totalAmountCurrency?: string;
  currency?: string;
  paymentMethods: PaymentMethod[];
  exchangeRate?: number;
  showDiscount?: boolean;
  maxDiscount?: number;
  showPmFee?: boolean;
  pmFeeRate?: number;
  requiresClientForDebt?: boolean;
  hasClient?: boolean;
  onPaymentChange: (lines: PaymentLine[]) => void;
  onDiscountChange?: (discount: number) => void;
  onPmFeesChange?: (fees: Record<string, number>) => void;
  /** Optional extra content between summary and payment input */
  children?: React.ReactNode;
}

export function PaymentSheet({
  open,
  onClose,
  onConfirm,
  isSubmitting = false,
  title = "Confirm Payment",
  subtitle,
  accentColor = "bg-violet-600 hover:bg-violet-500",
  confirmLabel,
  summary = [],
  totalAmount,
  totalAmountCurrency = "USD",
  currency = "USD",
  paymentMethods,
  exchangeRate,
  showDiscount = true,
  maxDiscount,
  showPmFee = false,
  pmFeeRate,
  requiresClientForDebt = true,
  hasClient = false,
  onPaymentChange,
  onDiscountChange,
  onPmFeesChange,
  children,
}: PaymentSheetProps) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Trigger animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!mounted) return null;

  const defaultConfirmLabel =
    confirmLabel ||
    (totalAmountCurrency === "LBP"
      ? `Pay ${totalAmount.toLocaleString()} LBP`
      : `Pay $${totalAmount.toFixed(2)}`);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Sheet Panel */}
      <div
        className={`relative w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <div>
            <h2 className="text-base font-bold text-white">{title}</h2>
            {subtitle && (
              <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Summary */}
          {summary.length > 0 && (
            <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Summary
              </h3>
              {summary.map((line, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-300">{line.label}</span>
                  <span
                    className={`font-mono font-semibold ${line.color || "text-white"}`}
                  >
                    {line.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Extra content */}
          {children}

          {/* Payment Method */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Payment Method
            </h3>
            <MultiPaymentInput
              totalAmount={totalAmount}
              totalAmountCurrency={totalAmountCurrency}
              currency={currency}
              onChange={onPaymentChange}
              requiresClientForDebt={requiresClientForDebt}
              hasClient={hasClient}
              showPmFee={showPmFee}
              {...(pmFeeRate !== undefined ? { pmFeeRate } : {})}
              {...(onPmFeesChange ? { onPmFeesChange } : {})}
              showDiscount={showDiscount}
              {...(maxDiscount !== undefined ? { maxDiscount } : {})}
              {...(onDiscountChange ? { onDiscountChange } : {})}
              paymentMethods={paymentMethods}
              currencies={[
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ]}
              {...(exchangeRate !== undefined ? { exchangeRate } : {})}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-700/50 bg-slate-800/50">
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={isSubmitting}
            className={`w-full py-3.5 rounded-xl font-bold text-base transition-all ${
              isSubmitting
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : `${accentColor} shadow-lg`
            }`}
          >
            {isSubmitting ? "Processing..." : defaultConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { ArrowUpRight, X, AlertTriangle, Info } from "lucide-react";
import { omtAppCashoutCommission } from "@liratek/core";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";

export type CashoutCurrency = "USD" | "LBP";

function fmtCommas(value: string): string {
  if (!value) return value;
  const parts = value.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function isPartialDecimal(value: string): boolean {
  return /^[0-9]*\.?[0-9]*$/.test(value);
}

export interface OmtAppCashoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    amount: number;
    currency: CashoutCurrency;
  }) => Promise<void>;
  /**
   * OMT_App wallet drawer balance per currency, used only for the
   * client-side "insufficient balance" hint below the amount field. The
   * server holds the authoritative guard (D15) — this exists to save the
   * operator a round trip, not to replace it.
   */
  walletBalance?: { usdBalance: number; lbpBalance: number } | undefined;
  /** Optional shared currency formatter (CurrencyContext); falls back to a
   *  plain USD/LBP formatting when not supplied. */
  formatAmount?: (
    amount: number | null | undefined,
    currencyCode: string,
  ) => string;
}

/**
 * "Cash Out to OMT" (D12/LIRA-192, internal type WALLET_CASHOUT) — the
 * mirror of the OMT-credit top-up: the OMT_App wallet balance goes DOWN and
 * the OMT account is credited principal + commission. No cash moves either
 * way (D2/§8.1).
 *
 * The commission preview is computed by `omtAppCashoutCommission`, the SAME
 * shared core constant/function the repository stamps on the transaction —
 * never a second hardcoded 0.1% here (rule 14; this is exactly the
 * preview-vs-stamp divergence class LIRA-185 is auditing).
 */
export function OmtAppCashoutModal({
  isOpen,
  onClose,
  onConfirm,
  walletBalance,
  formatAmount,
}: OmtAppCashoutModalProps) {
  useModalFocusFix(isOpen);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CashoutCurrency>("USD");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setCurrency("USD");
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const parsedAmount = parseFloat(amount) || 0;
  const commission =
    parsedAmount > 0 ? omtAppCashoutCommission(parsedAmount, currency) : 0;
  const accountCredit = parsedAmount + commission;

  const walletBalanceForCurrency =
    currency === "USD" ? walletBalance?.usdBalance : walletBalance?.lbpBalance;
  const exceedsWallet =
    walletBalanceForCurrency !== undefined &&
    parsedAmount > 0 &&
    parsedAmount > walletBalanceForCurrency;

  const display = (value: number, currencyCode: CashoutCurrency): string => {
    if (formatAmount) return formatAmount(value, currencyCode);
    return currencyCode === "USD"
      ? `$${value.toFixed(2)}`
      : `${value.toLocaleString()} LBP`;
  };

  const handleSubmit = async () => {
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert("Please enter a valid amount greater than 0");
      return;
    }
    // D15: block an over-draw client-side too, matching the repository guard
    // — the repository re-checks and is the source of truth.
    if (exceedsWallet) {
      alert("Amount exceeds the OMT App wallet balance");
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({ amount: parsedAmount, currency });
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Cash-out failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <ArrowUpRight className="text-slate-400" size={18} />
            Cash Out to OMT
          </h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Currency
            </label>
            <select
              data-testid="omt-app-cashout-currency"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value as CashoutCurrency);
                setAmount("");
              }}
              disabled={isSubmitting}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
            >
              <option value="USD">USD</option>
              <option value="LBP">LBP</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Amount
            </label>
            <div className="relative">
              <input
                data-testid="omt-app-cashout-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={fmtCommas(amount)}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/,/g, "");
                  if (isPartialDecimal(cleaned)) setAmount(cleaned);
                }}
                placeholder={currency === "LBP" ? "0" : "0.00"}
                disabled={isSubmitting}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                autoFocus
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                {currency}
              </span>
            </div>
            {exceedsWallet && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} />
                Amount exceeds the OMT App wallet balance
              </p>
            )}
          </div>

          {/* Commission preview + resulting account credit — both derived
              from the shared core commission function, never re-typed here. */}
          <div className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Commission (0.1%):</span>
              <span
                data-testid="omt-app-cashout-commission-preview"
                className="text-white font-mono font-medium"
              >
                {display(commission, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">OMT account credited:</span>
              <span className="text-emerald-400 font-mono font-medium">
                {display(accountCredit, currency)}
              </span>
            </div>
          </div>

          <div className="p-2 rounded bg-slate-800/50 border border-slate-700">
            <div className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
              <p className="text-[10px] leading-tight text-slate-400">
                No cash moves either way. The OMT App wallet balance goes
                down by the amount; the OMT account is credited the amount
                plus commission, recognised as profit once the account is
                settled.
              </p>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="omt-app-cashout-submit"
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                !amount ||
                parsedAmount <= 0 ||
                exceedsWallet
              }
              className="flex-1 px-4 py-2.5 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg bg-violet-600 hover:bg-violet-500 shadow-violet-500/20"
            >
              {isSubmitting ? "Processing..." : "Confirm Cash-Out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ServiceDebtDetailModal
 *
 * Shows the full breakdown of an OMT/WHISH SEND transaction that originated a
 * "Service Debt" entry. Opened from the eye button (👁) on debt entries.
 *
 * Displays:
 *   - Provider + service type + amount + provider fee
 *   - Full payment breakdown (Cash, WHISH Wallet + PM fee, Debt leg)
 *   - Client info
 */

import { X } from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentRowData {
  id: number;
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface FinancialServiceData {
  id: number;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
  omt_fee: number | null;
  whish_fee: number | null;
  payment_method_fee: number | null;
  omt_service_type: string | null;
  client_name: string | null;
  phone_number: string | null;
  reference_number: string | null;
  note: string | null;
  created_at: string;
}

interface Props {
  financialService: FinancialServiceData;
  payments: PaymentRowData[];
  debtAmount: number;
  /** True when the client has credit (shop owes them) — changes debt language to account charge */
  isCreditor?: boolean;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  DEBT: "Debt",
  OMT: "OMT Wallet",
  WHISH: "WHISH Wallet",
  BINANCE: "Binance",
  PM_FEE: "Wallet Surcharge (PM fee)",
  RESERVE: "Cash Reserve",
  TRANSFER: "Internal Transfer",
  COMMISSION: "Commission",
};

function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

/** Payment methods shown as customer-facing legs (skip internal accounting rows) */
const INTERNAL_METHODS = new Set([
  "RESERVE",
  "TRANSFER",
  "COMMISSION",
  "OMT",
  "WHISH",
]);

// ─── Component ────────────────────────────────────────────────────────────────

export function ServiceDebtDetailModal({
  financialService: fs,
  payments,
  debtAmount,
  isCreditor = false,
  onClose,
}: Props) {
  useModalFocusFix(true);
  const providerFee =
    fs.provider === "OMT" ? (fs.omt_fee ?? 0) : (fs.whish_fee ?? 0);
  const pmFee = fs.payment_method_fee ?? 0;
  const totalCharged = fs.amount + providerFee;

  /** Format amount with the correct currency symbol */
  const fmtCurrency = (amount: number, currencyCode?: string): string => {
    const curr = currencyCode || fs.currency;
    if (curr === "LBP") {
      return `${Math.abs(amount).toLocaleString()} LBP`;
    }
    return `$${Math.abs(amount).toFixed(2)}`;
  };

  // Customer-facing payment rows — filter out internal accounting entries
  const customerPayments = payments.filter(
    (p) => !INTERNAL_METHODS.has(p.method) && p.amount > 0,
  );

  // Total actually paid (non-debt legs)
  const totalPaid = customerPayments
    .filter((p) => p.method !== "DEBT" && p.method !== "PM_FEE")
    .reduce((s, p) => s + p.amount, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-base font-bold text-white">
              {fs.provider}{" "}
              <span className="text-slate-400 font-normal">
                {fs.service_type}
              </span>
              {fs.omt_service_type && (
                <span className="ml-2 text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full">
                  {fs.omt_service_type}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {new Date(fs.created_at).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Transaction summary */}
          <div className="bg-slate-800/60 rounded-xl p-3 space-y-1.5 border border-slate-700/40">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Send Amount</span>
              <span className="font-mono text-white font-semibold">
                {fmtCurrency(fs.amount)}
              </span>
            </div>
            {providerFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-amber-400">{fs.provider} Fee</span>
                <span className="font-mono text-amber-300">
                  +{fmtCurrency(providerFee)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-slate-700/50 pt-1.5 mt-1">
              <span className="text-slate-300 font-medium">Total Charged</span>
              <span className="font-mono text-white font-bold">
                {fmtCurrency(totalCharged)}
              </span>
            </div>
            {pmFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-violet-400">Shop Surcharge (PM fee)</span>
                <span className="font-mono text-violet-300">
                  +{fmtCurrency(pmFee)}
                </span>
              </div>
            )}
          </div>

          {/* Payment breakdown */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Payment Breakdown
            </h3>
            <div className="space-y-1.5">
              {customerPayments.map((p) => {
                const isDebt = p.method === "DEBT";
                const isPmFee = p.method === "PM_FEE";
                // Creditor: account charge (blue/sky), Debtor: debt (red)
                const debtBg = isCreditor
                  ? "bg-sky-950/40 border border-sky-500/20"
                  : "bg-red-950/40 border border-red-500/20";
                const debtDot = isCreditor ? "bg-sky-400" : "bg-red-400";
                const debtText = isCreditor ? "text-sky-300" : "text-red-300";
                const debtSubText = isCreditor
                  ? "text-sky-400/70"
                  : "text-red-400/70";
                const debtAmount$ = isCreditor
                  ? "text-sky-400"
                  : "text-red-400";
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                      isDebt
                        ? debtBg
                        : isPmFee
                          ? "bg-violet-950/30 border border-violet-500/20"
                          : "bg-slate-800/50 border border-slate-700/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          isDebt
                            ? debtDot
                            : isPmFee
                              ? "bg-violet-400"
                              : "bg-emerald-400"
                        }`}
                      />
                      <span
                        className={`text-sm font-medium ${
                          isDebt
                            ? debtText
                            : isPmFee
                              ? "text-violet-300"
                              : "text-slate-300"
                        }`}
                      >
                        {isDebt
                          ? isCreditor
                            ? "Account Charge"
                            : methodLabel(p.method)
                          : methodLabel(p.method)}
                        {isDebt && fs.client_name && (
                          <span className={`${debtSubText} font-normal ml-1`}>
                            ({fs.client_name})
                          </span>
                        )}
                      </span>
                    </div>
                    <span
                      className={`font-mono text-sm font-bold ${
                        isDebt
                          ? debtAmount$
                          : isPmFee
                            ? "text-violet-400"
                            : "text-emerald-400"
                      }`}
                    >
                      {p.currency_code === "USD" ? "$" : ""}
                      {Math.abs(p.amount).toFixed(2)}
                      {p.currency_code !== "USD" ? ` ${p.currency_code}` : ""}
                    </span>
                  </div>
                );
              })}
              {/* Debt/Account charge row (from debt_ledger — not in payments table) */}
              {debtAmount > 0 &&
                !customerPayments.some((p) => p.method === "DEBT") && (
                  <div
                    className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                      isCreditor
                        ? "bg-sky-950/40 border border-sky-500/20"
                        : "bg-red-950/40 border border-red-500/20"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${isCreditor ? "bg-sky-400" : "bg-red-400"}`}
                      />
                      <span
                        className={`text-sm font-medium ${isCreditor ? "text-sky-300" : "text-red-300"}`}
                      >
                        {isCreditor ? "Account Charge" : "Debt"}
                        {fs.client_name && (
                          <span
                            className={`${isCreditor ? "text-sky-400/70" : "text-red-400/70"} font-normal ml-1`}
                          >
                            ({fs.client_name})
                          </span>
                        )}
                      </span>
                    </div>
                    <span
                      className={`font-mono text-sm font-bold ${isCreditor ? "text-sky-400" : "text-red-400"}`}
                    >
                      {fmtCurrency(debtAmount)}
                    </span>
                  </div>
                )}
            </div>

            {/* Summary line */}
            {totalPaid > 0 && (
              <div className="flex justify-between text-xs text-slate-500 mt-2 px-1">
                <span>Paid (excl. account)</span>
                <span className="font-mono">{fmtCurrency(totalPaid)}</span>
              </div>
            )}
            {debtAmount > 0 && (
              <div
                className={`flex justify-between text-xs px-1 ${isCreditor ? "text-sky-400" : "text-red-400"}`}
              >
                <span>
                  {isCreditor ? "Charged to account" : "Remaining debt"}
                </span>
                <span className="font-mono">{fmtCurrency(debtAmount)}</span>
              </div>
            )}
          </div>

          {/* Client / Reference info */}
          {(fs.client_name || fs.phone_number || fs.reference_number) && (
            <div className="bg-slate-800/40 rounded-xl p-3 space-y-1 border border-slate-700/30">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Client Info
              </h3>
              {fs.client_name && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Name</span>
                  <span className="text-slate-200">{fs.client_name}</span>
                </div>
              )}
              {fs.phone_number && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Phone</span>
                  <span className="text-slate-200 font-mono">
                    {fs.phone_number}
                  </span>
                </div>
              )}
              {fs.reference_number && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Reference</span>
                  <span className="text-slate-200 font-mono">
                    {fs.reference_number}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Note */}
          {fs.note && (
            <p className="text-xs text-slate-500 italic px-1">{fs.note}</p>
          )}
        </div>
      </div>
    </div>
  );
}

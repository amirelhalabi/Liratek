import { History, RefreshCw, X, Send, ArrowDownToLine } from "lucide-react";
import { DataTable } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import type { FinancialTransaction, ServiceType } from "../types";
import { FINANCIAL_SERVICE_ICONS } from "../types";

const ICON_COMPONENTS = {
  Send: Send,
  ArrowDownToLine: ArrowDownToLine,
};

function getIconComponent(iconKey: string) {
  return (
    ICON_COMPONENTS[iconKey as keyof typeof ICON_COMPONENTS] ||
    ICON_COMPONENTS.Send
  );
}

interface HistoryModalProps {
  transactions: FinancialTransaction[];
  provider: string;
  onClose: () => void;
  onRefresh: () => void;
  formatAmount?: (val: number, currency: string) => string;
  amountLabel?: string;
  /** Override the "Profit" column header (e.g. "Fees" for financial services) */
  profitLabel?: string;
  /** When true, show separate "Fee" and "Profit" columns instead of a single column.
   *  Fee = commission when cost is 0 (transfers), Profit = commission when cost > 0 (bills) */
  showFeeAndProfit?: boolean;
  /** When true, the amount (credits) column always displays in USD regardless of the transaction currency */
  amountAlwaysUsd?: boolean;
}

export function HistoryModal({
  transactions,
  provider,
  onClose,
  onRefresh,
  formatAmount = (val, currency) =>
    `${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
  amountLabel = "Amount",
  profitLabel = "Profit",
  showFeeAndProfit = false,
  amountAlwaysUsd = false,
}: HistoryModalProps) {
  useModalFocusFix(true);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <History className="text-slate-400" size={18} />
            {provider} Transaction History
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({transactions.length} records)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <DataTable
            columns={[
              {
                header: "Type",
                className: "px-5 py-3",
                sortKey: "service_type",
              },
              {
                header: amountLabel,
                className: "px-5 py-3",
                sortKey: "amount",
              },
              {
                header: "Cost",
                className: "px-5 py-3",
                sortKey: "cost",
              },
              ...(showFeeAndProfit
                ? [
                    {
                      header: "Fee",
                      className: "px-5 py-3",
                      sortKey: "commission",
                    },
                    {
                      header: "Profit",
                      className: "px-5 py-3",
                      sortKey: "commission",
                    },
                  ]
                : [
                    {
                      header: profitLabel,
                      className: "px-5 py-3",
                      sortKey: "commission",
                    },
                  ]),
              {
                header: "Client",
                className: "px-5 py-3",
                sortKey: "client_name",
              },
              {
                header: "Payment",
                className: "px-5 py-3",
                sortKey: "paid_by",
              },
              {
                header: "Time",
                className: "px-5 py-3",
                sortKey: "created_at",
              },
            ]}
            data={transactions}
            exportExcel
            exportPdf
            exportFilename={`${provider.toLowerCase()}-history`}
            className="w-full"
            theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
            tbodyClassName="divide-y divide-slate-700/50"
            emptyMessage={`No ${provider} transactions yet.`}
            renderRow={(tx) => {
              const Icon = getIconComponent(
                FINANCIAL_SERVICE_ICONS[tx.service_type as ServiceType],
              );
              return (
                <tr
                  key={tx.id}
                  className="hover:bg-slate-700/20 transition-colors"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 text-slate-300">
                      <Icon width={14} height={14} />
                      <span className="text-sm">
                        {tx.service_type === "SEND" ? "Out" : "In"}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-sm font-medium text-white">
                    {formatAmount(
                      tx.amount,
                      amountAlwaysUsd ? "USD" : tx.currency,
                    )}
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-300">
                    {formatAmount(tx.cost ?? 0, tx.currency)}
                  </td>
                  {showFeeAndProfit ? (
                    <>
                      <td className="px-5 py-3 text-sm font-bold text-amber-400">
                        {(tx.cost ?? 0) === 0 && tx.commission !== 0
                          ? formatAmount(tx.commission, tx.currency)
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-sm font-bold text-emerald-400">
                        {(tx.cost ?? 0) > 0
                          ? formatAmount(tx.commission, tx.currency)
                          : "—"}
                      </td>
                    </>
                  ) : (
                    <td className="px-5 py-3 text-sm font-bold text-emerald-400">
                      {formatAmount(tx.commission, tx.currency)}
                    </td>
                  )}
                  <td className="px-5 py-3 text-sm text-slate-300">
                    {tx.client_name || "—"}
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-300">
                    {tx.paid_by || "—"}
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-400">
                    {new Date(tx.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    <div className="text-xs text-slate-500">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </div>
                  </td>
                </tr>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}

import { History, RefreshCw, X, Ban, User, Phone } from "lucide-react";
import { DataTable } from "@liratek/ui";
import type { CustomServiceEntry } from "../../../hooks/useCustomServices";

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function formatCurrency(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd > 0) parts.push(`$${usd.toFixed(2)}`);
  if (lbp > 0) parts.push(`${lbp.toLocaleString()} LBP`);
  return parts.join(" + ") || "$0.00";
}

interface HistoryModalProps {
  history: CustomServiceEntry[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onVoid: (id: number) => void;
}

export function HistoryModal({
  history,
  loading,
  onClose,
  onRefresh,
  onVoid,
}: HistoryModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <History className="text-slate-400" size={18} />
            Service History
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({history.length} records)
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
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          ) : (
            <DataTable<CustomServiceEntry>
              columns={[
                {
                  header: "Time",
                  className: "px-4 py-3",
                  sortKey: "created_at",
                },
                {
                  header: "Description",
                  className: "px-4 py-3",
                  sortKey: "description",
                },
                {
                  header: "Customer",
                  className: "px-4 py-3",
                  sortKey: "client_name",
                },
                {
                  header: "Cost",
                  className: "px-4 py-3 text-right",
                  sortKey: "cost_usd",
                },
                {
                  header: "Price",
                  className: "px-4 py-3 text-right",
                  sortKey: "price_usd",
                },
                {
                  header: "Profit",
                  className: "px-4 py-3 text-right",
                  sortKey: "profit_usd",
                },
                {
                  header: "Paid By",
                  className: "px-4 py-3",
                  sortKey: "paid_by",
                },
                { header: "", className: "px-4 py-3 w-10" },
              ]}
              data={history}
              exportExcel
              exportPdf
              exportFilename="custom-services-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No services recorded yet."
              renderRow={(tx) => (
                <tr
                  key={tx.id}
                  className="hover:bg-slate-700/20 transition-colors"
                >
                  <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">
                    {formatTime(tx.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-white font-medium">
                      {tx.description}
                    </div>
                    {tx.note && (
                      <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[200px]">
                        {tx.note}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {tx.client_name && (
                      <div className="text-sm text-white flex items-center gap-1">
                        <User size={12} className="text-slate-500" />
                        {tx.client_name}
                      </div>
                    )}
                    {tx.phone_number && (
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                        <Phone size={10} />
                        {tx.phone_number}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-mono text-slate-400">
                    {formatCurrency(tx.cost_usd, tx.cost_lbp)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-mono text-white font-medium">
                    {formatCurrency(tx.price_usd, tx.price_lbp)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-sm font-bold font-mono ${
                        tx.profit_usd >= 0 && tx.profit_lbp >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {formatCurrency(tx.profit_usd, tx.profit_lbp)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tx.paid_by === "DEBT"
                          ? "bg-orange-500/10 text-orange-400"
                          : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {tx.paid_by}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onVoid(tx.id)}
                      className="text-slate-600 hover:text-red-400 transition-colors p-1"
                      title="Void service"
                    >
                      <Ban size={14} />
                    </button>
                  </td>
                </tr>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}

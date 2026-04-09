import { History, RefreshCw, X, ArrowRight } from "lucide-react";
import { DataTable } from "@liratek/ui";

type ExchangeTx = {
  id: number;
  created_at: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  leg1_rate: number | null;
  leg1_market_rate: number | null;
  leg1_profit_usd: number | null;
  leg2_rate: number | null;
  leg2_market_rate: number | null;
  leg2_profit_usd: number | null;
  via_currency: string | null;
  profit_usd: number | null;
  amount_in: string | number;
  amount_out: string | number;
};

interface HistoryModalProps {
  transactions: ExchangeTx[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function HistoryModal({
  transactions,
  loading,
  onClose,
  onRefresh,
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
            Exchange History
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
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          ) : (
            <DataTable<ExchangeTx>
              columns={[
                {
                  header: "Time",
                  className: "px-4 py-3",
                  sortKey: "created_at",
                },
                {
                  header: "Pair",
                  className: "px-4 py-3",
                  sortKey: "from_currency",
                },
                {
                  header: "Amount In",
                  className: "px-4 py-3 text-right",
                  sortKey: "amount_in",
                },
                {
                  header: "Amount Out",
                  className: "px-4 py-3 text-right",
                  sortKey: "amount_out",
                },
                { header: "Via", className: "px-4 py-3 text-center" },
                {
                  header: "Profit",
                  className: "px-4 py-3 text-right",
                  sortKey: "profit_usd",
                },
              ]}
              data={transactions}
              exportExcel
              exportPdf
              exportFilename="exchange-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No exchanges yet."
              renderRow={(tx) => {
                const totalProfit =
                  tx.leg1_profit_usd !== null || tx.leg2_profit_usd !== null
                    ? (tx.leg1_profit_usd ?? 0) + (tx.leg2_profit_usd ?? 0)
                    : tx.profit_usd;

                return (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {new Date(tx.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
                          {tx.from_currency}
                        </span>
                        <ArrowRight size={10} className="text-slate-600" />
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
                          {tx.to_currency}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-emerald-400 text-right font-mono">
                      {Number(tx.amount_in).toLocaleString()} {tx.from_currency}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-red-400 text-right font-mono">
                      {Number(tx.amount_out).toLocaleString()} {tx.to_currency}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {tx.via_currency ? (
                        <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                          via {tx.via_currency}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-right">
                      {totalProfit !== null && totalProfit !== undefined ? (
                        <span
                          className={
                            totalProfit >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          ${Number(totalProfit).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

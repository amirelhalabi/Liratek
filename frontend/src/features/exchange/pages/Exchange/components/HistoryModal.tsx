import { useState } from "react";
import { History, RefreshCw, X, ArrowRight, Pencil, Check } from "lucide-react";
import { DataTable } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { EditHistoryPopover } from "@/shared/components/EditHistoryPopover";

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
  is_refunded?: number;
  refunded_at?: string | null;
  edited_by?: string | null;
  edited_at?: string | null;
  client_name?: string | null;
  note?: string | null;
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
  useModalFocusFix(true);
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    transactions,
    "created_at",
  );

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ client_name: "", note: "" });
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(tx: ExchangeTx) {
    setEditingId(tx.id);
    setEditForm({ client_name: tx.client_name ?? "", note: tx.note ?? "" });
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setEditSaving(true);
    try {
      const result = await window.api.exchange.updateMetadata({
        id: editingId,
        ...(editForm.client_name !== undefined && {
          client_name: editForm.client_name,
        }),
        ...(editForm.note !== undefined && { note: editForm.note }),
      });
      if (result.success) {
        setEditingId(null);
        onRefresh();
      } else {
        alert(result.error ?? "Failed to save");
      }
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
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
              ({filteredData.length} records)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <DateRangeFilter
              from={from}
              to={to}
              onFromChange={setFrom}
              onToChange={setTo}
            />
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
                { header: "", className: "px-4 py-3 w-10 text-center" },
              ]}
              data={filteredData}
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
                const isRefunded = Boolean(tx.is_refunded);
                const isEditing = editingId === tx.id;

                return (
                  <>
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-700/20 transition-colors${isRefunded ? " opacity-50" : ""}`}
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
                          {isRefunded && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              Refunded
                            </span>
                          )}
                          {tx.edited_by && (
                            <EditHistoryPopover
                              entityType="exchange_transaction"
                              entityId={tx.id}
                              trigger={
                                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/30 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400 cursor-pointer hover:bg-yellow-500/20 transition-colors">
                                  <Pencil size={8} />
                                  Edited
                                </span>
                              }
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-emerald-400 text-right font-mono">
                        {Number(tx.amount_in).toLocaleString()}{" "}
                        {tx.from_currency}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-red-400 text-right font-mono">
                        {Number(tx.amount_out).toLocaleString()}{" "}
                        {tx.to_currency}
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
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={handleSaveEdit}
                              disabled={editSaving}
                              className="p-1.5 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors disabled:opacity-50"
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1.5 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(tx)}
                            className="p-1.5 text-slate-500 hover:text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                            title="Edit metadata"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-slate-800/60 border-b border-slate-700/50">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex items-end gap-3 flex-wrap">
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">
                                Client Name
                              </label>
                              <input
                                value={editForm.client_name}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    client_name: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-48"
                                placeholder="Client name"
                              />
                            </div>
                            <div className="flex-1 min-w-[180px]">
                              <label className="text-xs text-slate-400 block mb-1">
                                Note
                              </label>
                              <input
                                value={editForm.note}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    note: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-full"
                                placeholder="Note"
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

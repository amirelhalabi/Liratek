import { useState } from "react";
import {
  History,
  RefreshCw,
  X,
  Ban,
  User,
  Phone,
  Pencil,
  Check,
  Tag,
} from "lucide-react";
import { DataTable } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { EditHistoryPopover } from "@/shared/components/EditHistoryPopover";
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
  useModalFocusFix(true);
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    history,
    "created_at",
  );

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    description: "",
    client_name: "",
    phone_number: "",
    note: "",
  });
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(tx: CustomServiceEntry) {
    setEditingId(tx.id);
    setEditForm({
      description: tx.description ?? "",
      client_name: tx.client_name ?? "",
      phone_number: tx.phone_number ?? "",
      note: tx.note ?? "",
    });
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setEditSaving(true);
    try {
      const result = await window.api.customServices.updateMetadata({
        id: editingId,
        ...(editForm.description !== undefined && {
          description: editForm.description,
        }),
        ...(editForm.client_name !== undefined && {
          client_name: editForm.client_name,
        }),
        ...(editForm.phone_number !== undefined && {
          phone_number: editForm.phone_number,
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
            Service History
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
                  header: "Category",
                  className: "px-4 py-3",
                  sortKey: "category",
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
                { header: "", className: "px-4 py-3 w-16" },
              ]}
              data={filteredData}
              exportExcel
              exportPdf
              exportFilename="custom-services-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No services recorded yet."
              renderRow={(tx) => {
                const isRefunded = Boolean(tx.is_refunded);
                const isEditing = editingId === tx.id;
                return (
                  <>
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-700/20 transition-colors${isRefunded ? " opacity-50" : ""}`}
                    >
                      <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">
                        {formatTime(tx.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-white font-medium flex items-center gap-1">
                          {tx.description}
                          {isRefunded && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              Refunded
                            </span>
                          )}
                          {tx.edited_by && (
                            <EditHistoryPopover
                              entityType="custom_service"
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
                        {tx.note && (
                          <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[200px]">
                            {tx.note}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {tx.category ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 border border-purple-500/30 text-purple-400">
                            <Tag size={10} />
                            {tx.category === "digital_account"
                              ? "Digital Account"
                              : tx.category.charAt(0).toUpperCase() +
                                tx.category.slice(1)}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
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
                        <div className="flex items-center gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={handleSaveEdit}
                                disabled={editSaving}
                                className="p-1 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors disabled:opacity-50"
                                title="Save"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-1 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                                title="Cancel"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(tx)}
                              className="p-1 text-slate-500 hover:text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                              title="Edit metadata"
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => onVoid(tx.id)}
                            className="text-slate-600 hover:text-red-400 transition-colors p-1"
                            title="Void service"
                          >
                            <Ban size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-slate-800/60 border-b border-slate-700/50">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="flex items-end gap-3 flex-wrap">
                            <div className="flex-1 min-w-[140px]">
                              <label className="text-xs text-slate-400 block mb-1">
                                Description
                              </label>
                              <input
                                value={editForm.description}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    description: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-full"
                                placeholder="Description"
                              />
                            </div>
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
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-40"
                                placeholder="Client name"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 block mb-1">
                                Phone
                              </label>
                              <input
                                value={editForm.phone_number}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    phone_number: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-36"
                                placeholder="Phone number"
                              />
                            </div>
                            <div className="flex-1 min-w-[120px]">
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

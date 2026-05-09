import { useState } from "react";
import { Calendar, RefreshCw, X, Ban, Pencil, Check } from "lucide-react";
import { DataTable } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useDateRangeFilter } from "@/shared/hooks/useDateRangeFilter";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import { EditHistoryPopover } from "@/shared/components/EditHistoryPopover";

interface Expense {
  id?: number;
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  is_refunded?: number;
  refunded_at?: string | null;
  edited_by?: string | null;
  edited_at?: string | null;
  note?: string | null;
}

interface HistoryModalProps {
  expenses: Expense[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onVoid: (id: number) => void;
}

export function HistoryModal({
  expenses,
  loading,
  onClose,
  onRefresh,
  onVoid,
}: HistoryModalProps) {
  useModalFocusFix(true);
  const { filteredData, from, to, setFrom, setTo } = useDateRangeFilter(
    expenses,
    "expense_date",
  );

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    description: "",
    category: "",
    note: "",
  });
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(expense: Expense) {
    setEditingId(expense.id!);
    setEditForm({
      description: expense.description ?? "",
      category: expense.category ?? "",
      note: expense.note ?? "",
    });
  }

  async function handleSaveEdit() {
    if (editingId === null) return;
    setEditSaving(true);
    try {
      const result = await window.api.expenses.updateMetadata({
        id: editingId,
        ...(editForm.description !== undefined && {
          description: editForm.description,
        }),
        ...(editForm.category !== undefined && { category: editForm.category }),
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
            <Calendar className="text-slate-400" size={18} />
            Expense History
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
            <DataTable<Expense>
              columns={[
                {
                  header: "Description",
                  className: "px-6 py-3",
                  sortKey: "description",
                },
                {
                  header: "Category",
                  className: "px-6 py-3",
                  sortKey: "category",
                },
                { header: "Paid By", className: "px-6 py-3" },
                {
                  header: "USD",
                  className: "px-6 py-3 text-right",
                  sortKey: "amount_usd",
                },
                { header: "LBP", className: "px-6 py-3 text-right" },
                { header: "Action", className: "px-6 py-3 text-center" },
              ]}
              data={filteredData}
              exportExcel
              exportPdf
              exportFilename="expenses-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No expenses recorded yet."
              renderRow={(expense) => {
                const isRefunded = Boolean(expense.is_refunded);
                const isEditing = editingId === expense.id;
                return (
                  <>
                    <tr
                      key={expense.id}
                      className={`hover:bg-slate-700/20 transition-colors${isRefunded ? " opacity-50" : ""}`}
                    >
                      <td className="px-6 py-4">
                        <div className="text-sm text-white font-medium flex items-center gap-1">
                          {expense.description}
                          {isRefunded && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              Refunded
                            </span>
                          )}
                          {expense.edited_by && (
                            <EditHistoryPopover
                              entityType="expense"
                              entityId={expense.id!}
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
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-0.5 bg-slate-700 text-slate-300 rounded-full text-xs font-medium">
                          {expense.category.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-400">Cash</td>
                      <td className="px-6 py-4 text-right text-sm font-bold text-orange-400 font-mono">
                        ${expense.amount_usd.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-bold text-orange-400 font-mono">
                        {expense.amount_lbp.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={handleSaveEdit}
                                disabled={editSaving}
                                className="p-1.5 text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors disabled:opacity-50"
                                title="Save"
                              >
                                <Check size={15} />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-1.5 text-slate-400 hover:bg-slate-700 rounded-lg transition-colors"
                                title="Cancel"
                              >
                                <X size={15} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(expense)}
                              className="p-1.5 text-slate-500 hover:text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                              title="Edit metadata"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => onVoid(expense.id!)}
                            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                            title="Void expense"
                          >
                            <Ban size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-slate-800/60 border-b border-slate-700/50">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="flex items-end gap-3 flex-wrap">
                            <div className="flex-1 min-w-[160px]">
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
                                Category
                              </label>
                              <input
                                value={editForm.category}
                                onChange={(e) =>
                                  setEditForm((f) => ({
                                    ...f,
                                    category: e.target.value,
                                  }))
                                }
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 w-44"
                                placeholder="Category"
                              />
                            </div>
                            <div className="flex-1 min-w-[160px]">
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

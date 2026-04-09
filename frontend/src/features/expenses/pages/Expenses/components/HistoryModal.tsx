import { Calendar, RefreshCw, X, Ban } from "lucide-react";
import { DataTable } from "@liratek/ui";

interface Expense {
  id?: number;
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
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
            <Calendar className="text-slate-400" size={18} />
            Expense History
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({expenses.length} records)
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
              data={expenses}
              exportExcel
              exportPdf
              exportFilename="expenses-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No expenses recorded yet."
              renderRow={(expense) => (
                <tr
                  key={expense.id}
                  className="hover:bg-slate-700/20 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="text-sm text-white font-medium">
                      {expense.description}
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
                    <button
                      onClick={() => onVoid(expense.id!)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Void expense"
                    >
                      <Ban size={16} />
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

import { useState, useEffect } from "react";
import logger from "../../../../utils/logger";
import { Plus, Ban, Calendar, DollarSign } from "lucide-react";
import { Select, useApi } from "@liratek/ui";
import { usePaymentMethods } from "../../../../hooks/usePaymentMethods";
import { DataTable } from "@/shared/components/DataTable";

interface Expense {
  id?: number;
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
}

const EXPENSE_CATEGORIES = [
  "Shop_Supply",
  "Bill",
  "Inventory_Loss",
  "Refund_Damaged",
  "Other",
];

export default function Expenses() {
  const api = useApi();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const { drawerAffectingMethods } = usePaymentMethods();
  const [formData, setFormData] = useState<Expense>({
    description: "",
    category: "Shop_Supply",
    paid_by_method: "CASH",
    amount_usd: 0,
    amount_lbp: 0,
    expense_date: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    loadTodayExpenses();
  }, []);

  const loadTodayExpenses = async () => {
    try {
      const data = await api.getTodayExpenses();
      setExpenses(data);
    } catch (error) {
      logger.error("Failed to load expenses:", error);
    }
  };

  const handleAddExpense = async () => {
    if (
      !formData.description.trim() ||
      (formData.amount_usd === 0 && formData.amount_lbp === 0)
    ) {
      alert("Please fill in all required fields.");
      return;
    }

    try {
      const result = await api.addExpense({
        ...formData,
        expense_date: new Date(formData.expense_date).toISOString(),
      });

      if (result.success) {
        setFormData({
          description: "",
          category: "Shop_Supply",
          paid_by_method: "CASH",
          amount_usd: 0,
          amount_lbp: 0,
          expense_date: new Date().toISOString().split("T")[0],
        });
        loadTodayExpenses();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      alert("Failed to add expense");
    }
  };

  const handleVoid = async (id: number) => {
    if (!confirm("Void this expense? Drawer balance will be restored.")) return;
    try {
      const result = await api.deleteExpense(id);
      if (result.success) {
        loadTodayExpenses();
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      alert("Failed to void expense");
    }
  };

  const totalUSD = expenses.reduce((sum, e) => sum + (e.amount_usd || 0), 0);
  const totalLBP = expenses.reduce((sum, e) => sum + (e.amount_lbp || 0), 0);

  return (
    <div className="h-full min-h-0 flex flex-col gap-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <DollarSign className="text-orange-400" size={24} />
          Expenses & Losses
        </h1>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-800 border border-slate-700/50 rounded-xl p-5 shadow-lg hover:border-slate-600 transition-colors">
          <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">
            Total USD
          </p>
          <p className="text-2xl font-bold text-white">
            ${totalUSD.toFixed(2)}
          </p>
        </div>
        <div className="bg-slate-800 border border-slate-700/50 rounded-xl p-5 shadow-lg hover:border-slate-600 transition-colors">
          <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">
            Total LBP
          </p>
          <p className="text-2xl font-bold text-white">
            {totalLBP.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
        {/* Left: Add Expense Form */}
        <div className="col-span-1 min-w-[380px] bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-4 flex flex-col overflow-hidden">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Plus className="text-orange-500" size={20} />
            Add New Expense
          </h2>

          <div className="space-y-4 flex-1 overflow-auto pr-2 custom-scrollbar">
            {/* Description */}
            <div>
              <label
                htmlFor="expense-description"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Description *
              </label>
              <input
                id="expense-description"
                type="text"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 outline-none transition-all"
                placeholder="e.g., Shop rent, Coffee, Repair"
              />
            </div>

            {/* Category */}
            <div>
              <label
                htmlFor="expense-category"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Category
              </label>
              <Select
                value={formData.category}
                onChange={(value) =>
                  setFormData({ ...formData, category: value })
                }
                options={EXPENSE_CATEGORIES.map((cat) => ({
                  value: cat,
                  label: cat.replace(/_/g, " "),
                }))}
                ringColor="ring-orange-500"
                buttonClassName="text-sm"
              />
            </div>

            {/* Paid By (payment method) */}
            <div>
              <label
                htmlFor="expense-paid-by"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Paid By
              </label>
              <Select
                value={formData.paid_by_method || "CASH"}
                onChange={(value) => {
                  setFormData({
                    ...formData,
                    paid_by_method: value,
                  });
                }}
                options={drawerAffectingMethods.map((m) => ({
                  value: m.code,
                  label: m.label,
                }))}
                ringColor="ring-orange-500"
                buttonClassName="text-sm"
              />
            </div>

            {/* Amounts */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div>
                <label
                  htmlFor="expense-amount-usd"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  Amount (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-500 font-bold">
                    $
                  </span>
                  <input
                    id="expense-amount-usd"
                    type="number"
                    value={formData.amount_usd || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        amount_usd: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-4 py-2.5 text-white focus:ring-2 focus:ring-orange-500 outline-none transition-all font-mono"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="expense-amount-lbp"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  Amount (LBP)
                </label>
                <input
                  id="expense-amount-lbp"
                  type="number"
                  value={formData.amount_lbp || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      amount_lbp: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-orange-500 outline-none transition-all font-mono"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Date */}
            <div>
              <label
                htmlFor="expense-date"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Date
              </label>
              <input
                id="expense-date"
                type="date"
                value={formData.expense_date}
                onChange={(e) =>
                  setFormData({ ...formData, expense_date: e.target.value })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-orange-500 outline-none transition-all"
              />
            </div>
          </div>

          <button
            onClick={handleAddExpense}
            className="w-full py-4 mt-6 rounded-xl font-bold text-lg bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/20 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            Record Expense
          </button>
        </div>

        {/* Right: History Table */}
        <div className="col-span-2 min-h-0 bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
              <Calendar className="text-slate-400" size={18} />
              Today's History
            </h2>
            <button
              onClick={loadTodayExpenses}
              className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-700"
            >
              <Plus className="rotate-45" size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <DataTable
              columns={[
                { header: "Description", className: "px-6 py-3" },
                { header: "Category", className: "px-6 py-3" },
                { header: "Paid By", className: "px-6 py-3" },
                { header: "USD", className: "px-6 py-3 text-right" },
                { header: "LBP", className: "px-6 py-3 text-right" },
                { header: "Action", className: "px-6 py-3 text-center" },
              ]}
              data={expenses}
              exportExcel
              exportPdf
              exportFilename="expenses"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No expenses recorded yet today."
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
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {drawerAffectingMethods.find(
                      (m) => m.code === expense.paid_by_method,
                    )?.label ||
                      expense.paid_by_method ||
                      "Cash"}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-orange-400 font-mono">
                    ${expense.amount_usd.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-orange-400 font-mono">
                    {expense.amount_lbp.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleVoid(expense.id!)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="Void expense"
                    >
                      <Ban size={16} />
                    </button>
                  </td>
                </tr>
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

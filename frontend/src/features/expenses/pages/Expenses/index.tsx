import { useState, useEffect } from "react";
import logger from "@/utils/logger";
import { Plus, Banknote, History } from "lucide-react";
import { PageHeader, Select, useApi } from "@liratek/ui";
import { HistoryModal } from "./components/HistoryModal";
import { StatsCards } from "../../components/StatsCards";

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
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      {/* Header with Stats and History */}
      <PageHeader
        icon={Banknote}
        title="Expenses"
        actions={
          <div className="flex items-center gap-2">
            <StatsCards totalUSD={totalUSD} totalLBP={totalLBP} />
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <History size={16} />
              <span className="font-medium">History</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 min-h-0">
        {/* Add Expense Form */}
        <div className="w-full max-w-2xl mx-auto bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-4 flex flex-col overflow-hidden">
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

            {/* Paid By — always Cash (only payment method for expenses) */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                Paid By
              </span>
              <span className="ml-auto text-sm text-slate-300 font-medium">
                💵 Cash
              </span>
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
      </div>

      {/* History Modal */}
      {showHistoryModal && (
        <HistoryModal
          expenses={expenses}
          loading={false}
          onClose={() => setShowHistoryModal(false)}
          onRefresh={loadTodayExpenses}
          onVoid={handleVoid}
        />
      )}
    </div>
  );
}

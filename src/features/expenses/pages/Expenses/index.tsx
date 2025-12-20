import { useState, useEffect } from "react";
import { Plus, Trash2, Calendar, DollarSign } from "lucide-react";

interface Expense {
  id?: number;
  description: string;
  category: string;
  expense_type: "Cash_Out" | "Non_Cash";
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
const EXPENSE_TYPES = [
  { value: "Cash_Out", label: "Cash Out (Affects Drawer)" },
  { value: "Non_Cash", label: "Non-Cash (Profit Only)" },
];

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Expense>({
    description: "",
    category: "Shop_Supply",
    expense_type: "Cash_Out",
    amount_usd: 0,
    amount_lbp: 0,
    expense_date: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    loadTodayExpenses();
  }, []);

  const loadTodayExpenses = async () => {
    try {
      if (!window.api) {
        setExpenses([
          {
            id: 1,
            description: "Mock Shop Rent",
            category: "Bill",
            expense_type: "Cash_Out",
            amount_usd: 50.0,
            amount_lbp: 0,
            expense_date: new Date().toISOString(),
          },
        ]);
        return;
      }
      const data = await window.api.getTodayExpenses();
      setExpenses(data);
    } catch (error) {
      console.error("Failed to load expenses:", error);
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
      if (!window.api) {
        const newEx: Expense = {
          id: Date.now(),
          ...formData,
        };
        setExpenses((prev) => [newEx, ...prev]);
        setFormData({
          description: "",
          category: "Shop_Supply",
          expense_type: "Cash_Out",
          amount_usd: 0,
          amount_lbp: 0,
          expense_date: new Date().toISOString().split("T")[0],
        });
        setIsModalOpen(false);
        return;
      }

      const result = await window.api.addExpense({
        ...formData,
        expense_date: new Date(formData.expense_date).toISOString(),
      });

      if (result.success) {
        alert("Expense added successfully!");
        setFormData({
          description: "",
          category: "Shop_Supply",
          expense_type: "Cash_Out",
          amount_usd: 0,
          amount_lbp: 0,
          expense_date: new Date().toISOString().split("T")[0],
        });
        setIsModalOpen(false);
        loadTodayExpenses();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      console.error(error);
      alert("Failed to add expense");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this expense?")) return;
    try {
      if (!window.api) {
        setExpenses((prev) => prev.filter((e) => e.id !== id));
        return;
      }
      const result = await window.api.deleteExpense(id);
      if (result.success) {
        loadTodayExpenses();
      }
    } catch (error) {
      console.error(error);
      alert("Failed to delete expense");
    }
  };

  const totalUSD = expenses.reduce((sum, e) => sum + (e.amount_usd || 0), 0);
  const totalLBP = expenses.reduce((sum, e) => sum + (e.amount_lbp || 0), 0);
  const cashOutUSD = expenses
    .filter((e) => e.expense_type === "Cash_Out")
    .reduce((sum, e) => sum + (e.amount_usd || 0), 0);

  return (
    <div className="h-full min-h-0 flex flex-col gap-6">
      <div className="flex-1 min-h-0 flex flex-col gap-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <DollarSign className="text-orange-400" size={32} />
            Expenses & Losses
          </h1>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-orange-600 hover:bg-orange-500 text-white px-6 py-3 rounded-lg font-bold shadow-lg shadow-orange-900/30 active:scale-95 transition-all flex items-center gap-2"
          >
            <Plus size={20} />
            Add Expense
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-xl">
            <p className="text-slate-400 text-sm font-medium mb-2">Total USD</p>
            <p className="text-3xl font-bold text-orange-400">
              ${totalUSD.toFixed(2)}
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-xl">
            <p className="text-slate-400 text-sm font-medium mb-2">Total LBP</p>
            <p className="text-3xl font-bold text-orange-400">
              {totalLBP.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-xl">
            <p className="text-slate-400 text-sm font-medium mb-2">
              Cash Out (Affects Drawer)
            </p>
            <p className="text-3xl font-bold text-red-400">
              ${cashOutUSD.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Expenses Table */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-xl flex-1 min-h-0 flex flex-col">
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Calendar size={20} className="text-slate-400" />
              Today's Expenses ({new Date().toLocaleDateString()})
            </h2>
          </div>

          {expenses.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <p>No expenses recorded yet.</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full">
                <thead className="bg-slate-700/50 text-slate-300 text-sm font-medium">
                  <tr>
                    <th className="px-6 py-4 text-left">Description</th>
                    <th className="px-6 py-4 text-left">Category</th>
                    <th className="px-6 py-4 text-left">Type</th>
                    <th className="px-6 py-4 text-right">USD</th>
                    <th className="px-6 py-4 text-right">LBP</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {expenses.map((expense) => (
                    <tr
                      key={expense.id}
                      className="hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="px-6 py-4 text-slate-200">
                        {expense.description}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 bg-slate-700 text-slate-300 rounded-full text-xs font-medium">
                          {expense.category}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold ${
                            expense.expense_type === "Cash_Out"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-yellow-500/20 text-yellow-400"
                          }`}
                        >
                          {expense.expense_type === "Cash_Out"
                            ? "Cash Out"
                            : "Non-Cash"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-200 font-mono">
                        ${expense.amount_usd.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-right text-slate-200 font-mono">
                        {expense.amount_lbp.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => handleDelete(expense.id!)}
                          className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add Expense Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setIsModalOpen(false);
            }
          }}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-700">
              <h2 className="text-2xl font-bold text-white">Add Expense</h2>
            </div>

            <div className="p-6 space-y-4">
              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Description *
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="e.g., Shop rent, Coffee, Broken phone"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Category *
                </label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Type *
                </label>
                <select
                  value={formData.expense_type}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      expense_type: e.target.value as "Cash_Out" | "Non_Cash",
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  {EXPENSE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount USD */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Amount (USD)
                </label>
                <input
                  type="number"
                  value={formData.amount_usd || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      amount_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="0.00"
                />
              </div>

              {/* Amount LBP */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Amount (LBP)
                </label>
                <input
                  type="number"
                  value={formData.amount_lbp || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      amount_lbp: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="0"
                />
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Date
                </label>
                <input
                  type="date"
                  value={formData.expense_date}
                  onChange={(e) =>
                    setFormData({ ...formData, expense_date: e.target.value })
                  }
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-700 flex gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="flex-1 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddExpense}
                className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold active:scale-95 transition-all"
              >
                Add Expense
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

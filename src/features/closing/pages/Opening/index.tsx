import { useState, useEffect } from "react";
import { useAuth } from "../../../auth/context/AuthContext";
import { X, DollarSign, Wallet, Phone } from "lucide-react";

export default function Opening({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const drawerTypes: Array<"General" | "OMT" | "MTC" | "Alfa"> = [
    "General",
    "OMT",
    "MTC",
    "Alfa",
  ];
  
  const { user } = useAuth();
  const [currencies, setCurrencies] = useState<Array<{ code: string; name: string }>>([]);
  const [amounts, setAmounts] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    if (isOpen) {
      loadCurrencies();
    }
  }, [isOpen]);

  const loadCurrencies = async () => {
    try {
      const list = await window.api.currencies.list();
      const active = list
        .filter((c: any) => c.is_active === 1)
        .map((c: any) => ({ code: c.code, name: c.name }));
      setCurrencies(active);
      
      // Initialize amounts structure with 0
      const init: Record<string, Record<string, number>> = {};
      for (const d of drawerTypes) {
        init[d] = {};
        for (const c of active) {
          init[d][c.code] = 0;
        }
      }
      setAmounts(init);
    } catch (error) {
      console.error("Failed to load currencies:", error);
    }
  };

  const handleAmountChange = (drawer: string, code: string, value: string) => {
    // Allow empty string for user input, will be saved as 0
    const numValue = value === "" ? 0 : parseFloat(value);
    setAmounts((prev) => ({
      ...prev,
      [drawer]: { 
        ...prev[drawer], 
        [code]: isNaN(numValue) ? 0 : numValue 
      },
    }));
  };

  // Get display value (show empty string instead of 0 for better UX)
  const getDisplayValue = (drawer: string, code: string): string => {
    const val = amounts[drawer]?.[code];
    if (val === undefined || val === 0) return "";
    return val.toString();
  };

  const handleSave = async () => {
    const closing_date = new Date().toISOString().split("T")[0];
    const dataToSave = [] as Array<{
      drawer_name: string;
      currency_code: string;
      opening_amount: number;
    }>;

    for (const d of drawerTypes) {
      for (const c of currencies) {
        const amount = amounts[d]?.[c.code] ?? 0;
        dataToSave.push({
          drawer_name: d,
          currency_code: c.code,
          opening_amount: amount,
        });
      }
    }

    try {
      const res = await window.api.closing.setOpeningBalances({
        closing_date,
        amounts: dataToSave,
        user_id: user?.id,
      });
      if (res.success) {
        alert("✅ Opening balances saved successfully!");
        onClose();
      } else {
        alert("❌ Failed: " + res.error);
      }
    } catch (error) {
      console.error(error);
      alert("❌ Failed to save opening balances.");
    }
  };

  const getDrawerIcon = (drawer: string) => {
    switch (drawer) {
      case "General": return <Wallet className="w-5 h-5" />;
      case "OMT": return <DollarSign className="w-5 h-5" />;
      case "MTC": return <Phone className="w-5 h-5" />;
      case "Alfa": return <Phone className="w-5 h-5" />;
      default: return <Wallet className="w-5 h-5" />;
    }
  };

  const getDrawerColor = (drawer: string) => {
    switch (drawer) {
      case "General": return "border-blue-500/30 bg-blue-500/5";
      case "OMT": return "border-green-500/30 bg-green-500/5";
      case "MTC": return "border-orange-500/30 bg-orange-500/5";
      case "Alfa": return "border-red-500/30 bg-red-500/5";
      default: return "border-slate-700 bg-slate-800/50";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden border border-slate-700/50">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">☀️ Opening Shift</h2>
            <p className="text-blue-100 text-sm mt-1">Set starting cash for all drawers</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white hover:bg-white/10 rounded-lg p-2 transition"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-180px)]">
          {/* All Drawers - Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {drawerTypes.map((drawer) => (
              <div
                key={drawer}
                className={`border-2 rounded-xl p-5 transition-all hover:shadow-lg ${getDrawerColor(drawer)}`}
              >
                {/* Drawer Header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-white/10 p-2 rounded-lg text-white">
                    {getDrawerIcon(drawer)}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white">{drawer}</h3>
                    <p className="text-xs text-slate-400">
                      {drawer === "General" && "Main cash register"}
                      {drawer === "OMT" && "Money transfers"}
                      {drawer === "MTC" && "Touch recharges"}
                      {drawer === "Alfa" && "Alfa recharges"}
                    </p>
                  </div>
                </div>

                {/* Currency Inputs */}
                <div className="space-y-3">
                  {currencies.map((currency) => (
                    <div key={currency.code} className="flex items-center gap-3">
                      <label className="text-sm font-semibold text-slate-300 w-16">
                        {currency.code}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={getDisplayValue(drawer, currency.code)}
                        onChange={(e) =>
                          handleAmountChange(drawer, currency.code, e.target.value)
                        }
                        placeholder="0.00"
                        autoComplete="off"
                        className="flex-1 bg-slate-900/50 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-lg font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-900/50 px-6 py-4 flex gap-3 border-t border-slate-700">
          <button
            onClick={handleSave}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-bold rounded-xl hover:from-emerald-500 hover:to-green-500 transition-all shadow-lg hover:shadow-emerald-500/20"
          >
            ✅ Save & Start Day
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-slate-700 text-slate-300 font-semibold rounded-xl hover:bg-slate-600 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

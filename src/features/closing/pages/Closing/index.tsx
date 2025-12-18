import { useState, useEffect } from "react";
import { X, DollarSign, Wallet, Phone, CheckCircle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { appEvents } from "../../../../shared/utils/appEvents";

export default function Closing({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const drawerTypes: Array<"General" | "OMT" | "MTC" | "Alfa"> = ["General", "OMT", "MTC", "Alfa"];
  
  const [step, setStep] = useState(1);
  const [currencies, setCurrencies] = useState<Array<{ code: string; name: string }>>([]);
  const [physicalAmounts, setPhysicalAmounts] = useState<Record<string, Record<string, number>>>({});
  const [systemExpected, setSystemExpected] = useState<any>(null);
  const [varianceNotes, setVarianceNotes] = useState("");

  useEffect(() => {
    if (isOpen) {
      loadCurrencies();
      if (step >= 2) {
        loadSystemExpected();
      }
    } else {
      // Reset on close
      setStep(1);
      setPhysicalAmounts({});
      setSystemExpected(null);
      setVarianceNotes("");
    }
  }, [isOpen, step]);

  const loadCurrencies = async () => {
    try {
      const list = await window.api.currencies.list();
      const active = list
        .filter((c: any) => c.is_active === 1)
        .map((c: any) => ({ code: c.code, name: c.name }));
      setCurrencies(active);
      
      // Initialize physical amounts
      const init: Record<string, Record<string, number>> = {};
      for (const d of drawerTypes) {
        init[d] = {};
        for (const c of active) {
          init[d][c.code] = 0;
        }
      }
      setPhysicalAmounts(init);
    } catch (error) {
      console.error("Failed to load currencies:", error);
    }
  };

  const loadSystemExpected = async () => {
    try {
      const balances = await window.api.closing.getSystemExpectedBalances();
      setSystemExpected(balances);
    } catch (error) {
      console.error("Failed to fetch expected balances:", error);
    }
  };

  const handleAmountChange = (drawer: string, code: string, value: string) => {
    const numValue = value === "" ? 0 : parseFloat(value);
    setPhysicalAmounts((prev) => ({
      ...prev,
      [drawer]: { 
        ...prev[drawer], 
        [code]: isNaN(numValue) ? 0 : numValue 
      },
    }));
  };

  // Get display value (show empty string instead of 0 for better UX)
  const getDisplayValue = (drawer: string, code: string): string => {
    const val = physicalAmounts[drawer]?.[code];
    if (val === undefined || val === 0) return "";
    return val.toString();
  };

  const handleSave = async () => {
    const closing_date = new Date().toISOString().split("T")[0];
    const amounts = [] as Array<{
      drawer_name: string;
      currency_code: string;
      physical_amount: number;
    }>;

    for (const d of drawerTypes) {
      for (const c of currencies) {
        const amount = physicalAmounts[d]?.[c.code] ?? 0;
        amounts.push({
          drawer_name: d,
          currency_code: c.code,
          physical_amount: amount,
        });
      }
    }

    try {
      const res = await window.api.closing.createDailyClosing({
        closing_date,
        amounts,
        variance_notes: varianceNotes,
      });

      if (res.success) {
        alert("✅ Closing saved successfully for all drawers");
        appEvents.emit("closing:completed", { closing_date, amounts });
        onClose();
      } else {
        alert("❌ Failed to save closing: " + res.error);
      }
    } catch (error) {
      console.error("Failed to save closing:", error);
      alert("❌ Failed to save closing.");
    }
  };

  // Helper to get expected amount for a drawer/currency
  const getExpectedAmount = (drawer: string, currencyCode: string): number => {
    if (!systemExpected) return 0;
    const drawerKey = `${drawer.toLowerCase()}Drawer`;
    return systemExpected[drawerKey]?.[currencyCode.toLowerCase()] || 0;
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
      <div className="bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden border border-slate-700/50">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-red-600 px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">🌙 Closing Shift</h2>
            <p className="text-orange-100 text-sm mt-1">
              Step {step} of 3: {step === 1 ? "Physical Count" : step === 2 ? "Review Variance" : "Confirm & Save"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white hover:bg-white/10 rounded-lg p-2 transition"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-220px)]">
          {/* Step 1: Physical Count (Blind) */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                <p className="text-yellow-200 font-semibold">
                  💡 <strong>Blind Count:</strong> Enter the physical cash you count WITHOUT looking at expected amounts.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {drawerTypes.map((drawer) => (
                  <div key={drawer} className={`border-2 rounded-xl p-5 ${getDrawerColor(drawer)}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="bg-white/10 p-2 rounded-lg text-white">
                        {getDrawerIcon(drawer)}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-white">{drawer}</h3>
                        <p className="text-xs text-slate-400">Physical count</p>
                      </div>
                    </div>

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
                            className="flex-1 bg-slate-900/50 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-lg font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Review Variance */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                <p className="text-blue-200 font-semibold">
                  📊 <strong>Variance Review:</strong> Compare your physical count with expected amounts.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {drawerTypes.map((drawer) => (
                  <div key={drawer} className={`border-2 rounded-xl p-5 ${getDrawerColor(drawer)}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="bg-white/10 p-2 rounded-lg text-white">
                        {getDrawerIcon(drawer)}
                      </div>
                      <h3 className="font-bold text-lg text-white">{drawer}</h3>
                    </div>

                    <div className="space-y-3">
                      {currencies.map((currency) => {
                        const physical = physicalAmounts[drawer]?.[currency.code] || 0;
                        const expected = getExpectedAmount(drawer, currency.code);
                        const variance = physical - expected;
                        const hasVariance = Math.abs(variance) > 0.01;

                        return (
                          <div key={currency.code} className="bg-slate-900/30 rounded-lg p-3 space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-semibold text-slate-300">{currency.code}</span>
                              {hasVariance && (
                                <span className={`text-xs font-bold ${variance > 0 ? 'text-green-400' : variance < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                                  {variance > 0 ? <TrendingUp className="w-4 h-4 inline" /> : variance < 0 ? <TrendingDown className="w-4 h-4 inline" /> : <Minus className="w-4 h-4 inline" />}
                                  {variance > 0 ? '+' : ''}{variance.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-slate-500">Expected:</span>
                                <span className="text-white font-mono ml-2">{expected.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Physical:</span>
                                <span className="text-white font-mono ml-2">{physical.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                <p className="text-green-200 font-semibold flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  <strong>Ready to Save:</strong> Add any notes and confirm the closing.
                </p>
              </div>

              <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700">
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Variance Notes (Optional)
                </label>
                <textarea
                  value={varianceNotes}
                  onChange={(e) => setVarianceNotes(e.target.value)}
                  placeholder="Explain any variances or issues..."
                  rows={4}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700">
                <h4 className="font-bold text-white mb-2">Summary</h4>
                <p className="text-slate-400 text-sm">
                  Closing for <strong className="text-white">{drawerTypes.length} drawers</strong> with{" "}
                  <strong className="text-white">{currencies.length} currencies</strong> each.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-900/50 px-6 py-4 flex gap-3 border-t border-slate-700">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-6 py-3 bg-slate-700 text-slate-300 font-semibold rounded-xl hover:bg-slate-600 transition"
            >
              ← Back
            </button>
          )}
          
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold rounded-xl hover:from-blue-500 hover:to-violet-500 transition-all shadow-lg"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white font-bold rounded-xl hover:from-emerald-500 hover:to-green-500 transition-all shadow-lg hover:shadow-emerald-500/20"
            >
              ✅ Save & Close Shift
            </button>
          )}

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

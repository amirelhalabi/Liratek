import { useState, useEffect } from "react";
import { X, Wallet } from "lucide-react";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { DRAWER_ORDER, DRAWER_CONFIGS } from "../config/drawers";

// Hardcoded per-drawer currency support — mirrors what currency_drawers seeds at install
const DRAWER_DEFAULT_CURRENCIES: Record<string, string[]> = {
  General: ["USD", "LBP"],
  OMT_System: ["USD", "LBP"],
  OMT_App: ["USD"],
  Whish_App: ["USD"],
  Whish_System: ["USD"],
  Binance: ["USDT"],
  MTC: ["LBP"],
  Alfa: ["LBP"],
  iPick: ["USD"],
  Katsh: ["USD"],
};

// Module required to show each drawer (mirrors Dashboard drawerModuleMap)
const DRAWER_MODULE_REQUIREMENT: Record<string, string> = {
  OMT_System: "ipec_katch",
  OMT_App: "ipec_katch",
  Whish_App: "ipec_katch",
  Whish_System: "ipec_katch",
  Binance: "binance",
  MTC: "recharge",
  Alfa: "recharge",
  iPick: "ipec_katch",
  Katsh: "ipec_katch",
};

// Tailwind accent colors for each drawer
const DRAWER_ACCENT: Record<string, string> = {
  General: "blue",
  OMT_System: "green",
  OMT_App: "lime",
  Whish_App: "emerald",
  Whish_System: "fuchsia",
  Binance: "yellow",
  MTC: "orange",
  Alfa: "red",
  iPick: "sky",
  Katsh: "amber",
};

function formatCurrencyAmount(amount: number, currency: string): string {
  if (currency === "LBP") {
    return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return amount.toFixed(2);
}

interface InitialDrawerAmountsModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function InitialDrawerAmountsModal({
  onClose,
  onSaved,
}: InitialDrawerAmountsModalProps) {
  useModalFocusFix(true);
  const { isModuleEnabled } = useModules();
  const { user } = useAuth();

  // drawer → currency → string input value
  const [amounts, setAmounts] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which drawers to show, filtered by enabled modules
  const visibleDrawers = DRAWER_ORDER.filter((name) => {
    const required = DRAWER_MODULE_REQUIREMENT[name];
    return !required || isModuleEnabled(required);
  });

  // Pre-fill with current drawer_balances (so operator sees existing state)
  useEffect(() => {
    window.api.closing.getSystemExpectedBalancesDynamic().then((balances) => {
      const initial: Record<string, Record<string, string>> = {};
      for (const drawer of visibleDrawers) {
        const currencies = DRAWER_DEFAULT_CURRENCIES[drawer] ?? ["USD"];
        initial[drawer] = {};
        for (const currency of currencies) {
          const existing = balances[drawer]?.[currency] ?? 0;
          initial[drawer][currency] =
            existing === 0 ? "" : formatCurrencyAmount(existing, currency);
        }
      }
      setAmounts(initial);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(drawer: string, currency: string, value: string) {
    setAmounts((prev) => ({
      ...prev,
      [drawer]: { ...prev[drawer], [currency]: value },
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const amountRows: Array<{
      drawer_name: string;
      currency_code: string;
      expected_amount: number;
      physical_amount: number;
    }> = [];

    for (const drawer of visibleDrawers) {
      const currencies = DRAWER_DEFAULT_CURRENCIES[drawer] ?? ["USD"];
      for (const currency of currencies) {
        const raw = amounts[drawer]?.[currency] ?? "";
        const parsed = raw === "" ? 0 : parseFloat(raw.replace(/,/g, ""));
        if (isNaN(parsed)) {
          setError(`Invalid amount for ${drawer} (${currency})`);
          setSaving(false);
          return;
        }
        amountRows.push({
          drawer_name: drawer,
          currency_code: currency,
          expected_amount: parsed,
          physical_amount: parsed,
        });
      }
    }

    const result = await window.api.closing.createCheckpoint({
      user_id: user?.id ?? 0,
      drawer_name: "AGGREGATED",
      notes: "Initial drawer amounts setup",
      amounts: amountRows,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error ?? "Failed to save drawer amounts");
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 rounded-2xl border border-slate-700/50 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <Wallet className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                Initial Drawer Amounts
              </h2>
              <p className="text-xs text-slate-400">
                Set the starting cash for each active drawer
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — two drawer cards per row */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            {visibleDrawers.map((drawer) => {
              const config = DRAWER_CONFIGS[drawer as keyof typeof DRAWER_CONFIGS];
              const currencies = DRAWER_DEFAULT_CURRENCIES[drawer] ?? ["USD"];
              const accent = DRAWER_ACCENT[drawer] ?? "slate";

              return (
                <div
                  key={drawer}
                  className={`bg-slate-800/60 rounded-xl border border-slate-700/40 border-l-4 border-l-${accent}-500 px-3 py-3`}
                >
                  <span className={`text-xs font-semibold text-${accent}-400 block mb-2`}>
                    {config?.label ?? drawer}
                  </span>
                  <div className={`grid gap-2 ${currencies.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                    {currencies.map((currency) => (
                      <div key={currency}>
                        <label className="text-xs text-slate-500 block mb-1">
                          {currency}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step={currency === "LBP" ? "1000" : "0.01"}
                          value={amounts[drawer]?.[currency] ?? ""}
                          onChange={(e) =>
                            handleChange(drawer, currency, e.target.value)
                          }
                          placeholder="0"
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 placeholder:text-slate-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700/50 shrink-0">
          {error && (
            <p className="text-sm text-red-400 mb-3">{error}</p>
          )}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              Skip for now
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save Amounts"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

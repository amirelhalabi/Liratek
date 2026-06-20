import { useState } from "react";
import { Wallet } from "lucide-react";
import { useSetup } from "../context/SetupContext";
import { DRAWER_ORDER, DRAWER_CONFIGS } from "../../closing/config/drawers";
import type { DrawerType } from "../../closing/types";

// Per-drawer default currencies (mirrors currency_drawers seed)
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

// Module required to show each drawer
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

export default function StepDrawerAmounts() {
  const { payload, updatePayload, setStep } = useSetup();

  // drawer → currency → string value
  const [amounts, setAmounts] = useState<Record<string, Record<string, string>>>({});

  const enabledModules = payload.enabled_modules;

  const visibleDrawers = DRAWER_ORDER.filter((name) => {
    const required = DRAWER_MODULE_REQUIREMENT[name];
    return !required || enabledModules.includes(required);
  });

  function handleChange(drawer: string, currency: string, value: string) {
    setAmounts((prev) => ({
      ...prev,
      [drawer]: { ...prev[drawer], [currency]: value },
    }));
  }

  function buildDrawerAmounts() {
    const rows: Array<{
      drawer_name: string;
      currency_code: string;
      amount: number;
    }> = [];
    for (const drawer of visibleDrawers) {
      const currencies = DRAWER_DEFAULT_CURRENCIES[drawer] ?? ["USD"];
      for (const currency of currencies) {
        const raw = amounts[drawer]?.[currency] ?? "";
        const parsed = raw === "" ? 0 : parseFloat(raw.replace(/,/g, ""));
        if (!isNaN(parsed) && parsed !== 0) {
          rows.push({ drawer_name: drawer, currency_code: currency, amount: parsed });
        }
      }
    }
    return rows;
  }

  function handleNext() {
    // Store amounts in payload so StepComplete can apply them post-setup
    updatePayload({ drawer_amounts: buildDrawerAmounts() });
    setStep(7);
  }

  function handleSkip() {
    updatePayload({ drawer_amounts: [] });
    setStep(7);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Starting Drawer Amounts</h2>
        <p className="text-sm text-slate-400">
          Optionally set the initial cash for each active drawer. Leave fields empty to start at zero.
          You can always update these later from the Dashboard.
        </p>
      </div>

      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {visibleDrawers.map((drawer) => {
          const config = DRAWER_CONFIGS[drawer as DrawerType];
          const currencies = DRAWER_DEFAULT_CURRENCIES[drawer] ?? ["USD"];
          const accent = DRAWER_ACCENT[drawer] ?? "slate";

          return (
            <div
              key={drawer}
              className={`bg-slate-900 rounded-xl border border-slate-600/40 border-l-4 border-l-${accent}-500 px-4 py-3`}
            >
              <div className="flex items-center gap-2 mb-3">
                <Wallet className={`w-3.5 h-3.5 text-${accent}-400`} />
                <span className={`text-sm font-semibold text-${accent}-400`}>
                  {config?.label ?? drawer}
                </span>
                {config?.description && (
                  <span className="text-xs text-slate-500">— {config.description}</span>
                )}
              </div>
              <div
                className={`grid gap-3 ${currencies.length === 1 ? "grid-cols-1 max-w-xs" : "grid-cols-2"}`}
              >
                {currencies.map((currency) => (
                  <div key={currency}>
                    <label className="text-xs text-slate-400 block mb-1">{currency}</label>
                    <input
                      type="number"
                      min="0"
                      step={currency === "LBP" ? "1000" : "0.01"}
                      value={amounts[drawer]?.[currency] ?? ""}
                      onChange={(e) => handleChange(drawer, currency, e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 placeholder:text-slate-600"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between pt-2">
        <button
          onClick={() => setStep(5)}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleNext}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { DecimalInput } from "@liratek/ui";
import { useSetup } from "../context/SetupContext";
import { DRAWER_ORDER, DRAWER_CONFIGS } from "../../closing/config/drawers";
import type { DrawerType } from "../../closing/types";

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

  // drawer → currency → numeric value
  const [amounts, setAmounts] = useState<
    Record<string, Record<string, number>>
  >({});
  // drawer → currency_code[] — the configured currencies, read from the DB
  // (currency_drawers) so this screen always matches the rest of the app.
  const [drawerCurrencies, setDrawerCurrencies] = useState<
    Record<string, string[]>
  >({});

  const enabledModules = payload.enabled_modules;

  const visibleDrawers = DRAWER_ORDER.filter((name) => {
    const required = DRAWER_MODULE_REQUIREMENT[name];
    return !required || enabledModules.includes(required);
  });

  useEffect(() => {
    window.api?.currencies
      .allDrawerCurrencies()
      .then((configured) => setDrawerCurrencies(configured ?? {}));
  }, []);

  function handleChange(drawer: string, currency: string, value: number) {
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
      for (const currency of drawerCurrencies[drawer] ?? []) {
        const amt = amounts[drawer]?.[currency] ?? 0;
        if (amt !== 0) {
          rows.push({
            drawer_name: drawer,
            currency_code: currency,
            amount: amt,
          });
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
        <h2 className="text-xl font-bold text-white mb-1">
          Starting Drawer Amounts
        </h2>
        <p className="text-sm text-slate-400">
          Optionally set the initial cash for each active drawer. Leave fields
          empty to start at zero. You can always update these later from the
          Dashboard.
        </p>
      </div>

      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {visibleDrawers.map((drawer) => {
          const config = DRAWER_CONFIGS[drawer as DrawerType];
          const currencies = drawerCurrencies[drawer] ?? [];
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
                  <span className="text-xs text-slate-500">
                    — {config.description}
                  </span>
                )}
              </div>
              <div
                className={`grid gap-3 ${currencies.length <= 1 ? "grid-cols-1 max-w-xs" : "grid-cols-2"}`}
              >
                {currencies.map((currency) => (
                  <div
                    key={currency}
                    data-testid={`setup-amount-${drawer}-${currency}`}
                  >
                    <label className="text-xs text-slate-400 block mb-1">
                      {currency}
                    </label>
                    <DecimalInput
                      value={amounts[drawer]?.[currency] ?? 0}
                      onChange={(v) => handleChange(drawer, currency, v)}
                      decimals={currency === "LBP" ? 0 : 2}
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

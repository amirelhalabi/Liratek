import { useState, useEffect } from "react";
import { X, Wallet, Plus } from "lucide-react";
import { DecimalInput, useApi } from "@liratek/ui";
import { useModules } from "@/contexts/ModuleContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { DRAWER_ORDER, DRAWER_CONFIGS } from "../config/drawers";

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

interface InitialDrawerAmountsModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function InitialDrawerAmountsModal({
  onClose,
  onSaved,
}: InitialDrawerAmountsModalProps) {
  useModalFocusFix(true);
  const api = useApi();
  const { isModuleEnabled } = useModules();
  const { user } = useAuth();
  const { activeCurrencies, getDecimals } = useCurrencyContext();

  // drawer → currency → numeric input value
  const [amounts, setAmounts] = useState<
    Record<string, Record<string, number>>
  >({});
  // Currencies shown per drawer. Seeded from the countable set (base
  // allowlist ∪ non-zero-balance currencies) and grown when the operator
  // adds a currency.
  const [drawerCurrencies, setDrawerCurrencyState] = useState<
    Record<string, string[]>
  >({});
  // The currency set persisted in the DB at load time, used to detect which
  // drawers gained a currency and need a currency_drawers update on save.
  const [baselineCurrencies, setBaselineCurrencies] = useState<
    Record<string, string[]>
  >({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which drawers to show, filtered by enabled modules
  const visibleDrawers = DRAWER_ORDER.filter((name) => {
    const required = DRAWER_MODULE_REQUIREMENT[name];
    return !required || isModuleEnabled(required);
  });

  // Load the countable currencies per drawer (base allowlist ∪ any currency
  // holding a non-zero balance there — GENERAL_DRAWER_UNRESTRICTED.md D2/D5)
  // + current balances so the operator sees existing state and the real
  // per-drawer countable set.
  useEffect(() => {
    Promise.all([
      api.getCountableDrawerCurrencies(),
      api.getSystemExpectedBalancesDynamic(),
    ]).then(([configured, balances]) => {
      const initialCurrencies: Record<string, string[]> = {};
      const initialAmounts: Record<string, Record<string, number>> = {};
      for (const drawer of visibleDrawers) {
        const currencies = configured[drawer] ?? [];
        initialCurrencies[drawer] = [...currencies];
        initialAmounts[drawer] = {};
        for (const currency of currencies) {
          initialAmounts[drawer][currency] = balances[drawer]?.[currency] ?? 0;
        }
      }
      setDrawerCurrencyState(initialCurrencies);
      setBaselineCurrencies(initialCurrencies);
      setAmounts(initialAmounts);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(drawer: string, currency: string, value: number) {
    setAmounts((prev) => ({
      ...prev,
      [drawer]: { ...prev[drawer], [currency]: value },
    }));
  }

  function handleAddCurrency(drawer: string, currency: string) {
    if (!currency) return;
    setDrawerCurrencyState((prev) => {
      if (prev[drawer]?.includes(currency)) return prev;
      return { ...prev, [drawer]: [...(prev[drawer] ?? []), currency] };
    });
    setAmounts((prev) => ({
      ...prev,
      [drawer]: { ...prev[drawer], [currency]: prev[drawer]?.[currency] ?? 0 },
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    // Persist any newly-added currencies to currency_drawers first, so the
    // drawer's currency set stays the single source of truth. Only drawers
    // whose set grew need an update.
    for (const drawer of visibleDrawers) {
      const current = drawerCurrencies[drawer] ?? [];
      const baseline = baselineCurrencies[drawer] ?? [];
      const grew = current.some((c) => !baseline.includes(c));
      if (grew) {
        const res = await api.setDrawerCurrencies(drawer, current);
        if (!res.success) {
          setSaving(false);
          setError(res.error ?? `Failed to add currency to ${drawer}`);
          return;
        }
      }
    }

    const amountRows: Array<{
      drawer_name: string;
      currency_code: string;
      expected_amount: number;
      physical_amount: number;
    }> = [];

    for (const drawer of visibleDrawers) {
      for (const currency of drawerCurrencies[drawer] ?? []) {
        const parsed = amounts[drawer]?.[currency] ?? 0;
        amountRows.push({
          drawer_name: drawer,
          currency_code: currency,
          expected_amount: parsed,
          physical_amount: parsed,
        });
      }
    }

    const result = await api.createCheckpoint({
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
              const config =
                DRAWER_CONFIGS[drawer as keyof typeof DRAWER_CONFIGS];
              const currencies = drawerCurrencies[drawer] ?? [];
              const accent = DRAWER_ACCENT[drawer] ?? "slate";
              const addable = activeCurrencies.filter(
                (c) => !currencies.includes(c.code),
              );

              return (
                <div
                  key={drawer}
                  className={`bg-slate-800/60 rounded-xl border border-slate-700/40 border-l-4 border-l-${accent}-500 px-3 py-3`}
                >
                  <span
                    className={`text-xs font-semibold text-${accent}-400 block mb-2`}
                  >
                    {config?.label ?? drawer}
                  </span>
                  <div
                    className={`grid gap-2 ${currencies.length <= 1 ? "grid-cols-1" : "grid-cols-2"}`}
                  >
                    {currencies.map((currency) => (
                      <div key={currency}>
                        <label className="text-xs text-slate-500 block mb-1">
                          {currency}
                        </label>
                        <DecimalInput
                          value={amounts[drawer]?.[currency] ?? 0}
                          onChange={(v) => handleChange(drawer, currency, v)}
                          decimals={getDecimals(currency)}
                          placeholder="0"
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500 placeholder:text-slate-600"
                        />
                      </div>
                    ))}
                  </div>
                  {/* Add currency — General till only, same restriction as
                      the setup wizard's StepDrawerAmounts (foreign cash
                      lives in the physical register; provider drawers keep
                      their fixed business currency). */}
                  {drawer === "General" && addable.length > 0 && (
                    <div className="relative mt-2">
                      <Plus className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                        value=""
                        data-testid={`initial-drawer-add-currency-${drawer}`}
                        onChange={(e) =>
                          handleAddCurrency(drawer, e.target.value)
                        }
                        className="w-full bg-slate-900/60 border border-dashed border-slate-600 rounded-lg pl-6 pr-2 py-1.5 text-xs text-slate-400 focus:outline-none focus:border-orange-500 cursor-pointer"
                      >
                        <option value="">Add currency</option>
                        {addable.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                            {c.name ? ` — ${c.name}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {loaded && visibleDrawers.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">
              No drawers to configure.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700/50 shrink-0">
          {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              Skip for now
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !loaded}
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

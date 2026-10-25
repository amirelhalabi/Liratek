import { useState, useEffect } from "react";
import { X, Wallet, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "@liratek/ui/i18n/serverMessage";
import { DecimalInput, useApi } from "@liratek/ui";
import { useModules } from "@/contexts/ModuleContext";
import { useShopBase } from "@/hooks/useShopBase";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import logger from "@/utils/logger";
import { DRAWER_ORDER } from "../config/drawers";
import { useDrawerText } from "../hooks/useDrawerText";
import { isDrawerVisible, isUnrestrictedDrawer } from "@liratek/core";

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
  const { t } = useTranslation("closing");
  const { t: tc } = useTranslation("common");
  const drawerText = useDrawerText();
  const api = useApi();
  const { isModuleEnabled } = useModules();
  const { baseSystem, loading: baseSystemLoading } = useShopBase();
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

  // Which drawers to offer for counting. The comment on the local copy this
  // replaces said it "mirrors Dashboard drawerModuleMap" -- it did, including
  // the bug, which is why the mapping now lives in ONE place.
  const moduleDrawers = DRAWER_ORDER.filter((name) =>
    isDrawerVisible(name, isModuleEnabled),
  );
  // Each drawer's balance at load time. Until it arrives (null) nothing is
  // hidden on its account; after that, the other system's cash drawer is
  // left out while empty — the shop has no such physical drawer to count.
  const [loadedBalances, setLoadedBalances] = useState<Record<
    string,
    Record<string, number>
  > | null>(null);
  const visibleDrawers = moduleDrawers.filter((name) =>
    isDrawerVisible(name, isModuleEnabled, {
      baseSystem: baseSystemLoading ? null : baseSystem,
      balances: loadedBalances ? (loadedBalances[name] ?? {}) : null,
    }),
  );

  // Load the countable currencies per drawer (base allowlist ∪ any currency
  // holding a non-zero balance there — GENERAL_DRAWER_UNRESTRICTED.md D2/D5)
  // + current balances so the operator sees existing state and the real
  // per-drawer countable set.
  // Shop-day 2026-10-16: a failed load (e.g. a 429 burst) used to leave the
  // window empty with no message. It now says so and offers Retry; Save
  // stays off until the drawers load.
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadDrawers = () => {
    setLoadError(null);
    Promise.all([
      api.getCountableDrawerCurrencies(),
      api.getSystemExpectedBalancesDynamic(),
    ])
      .then(([configured, balances]) => {
        const initialCurrencies: Record<string, string[]> = {};
        const initialAmounts: Record<string, Record<string, number>> = {};
        for (const drawer of moduleDrawers) {
          const currencies = configured[drawer] ?? [];
          initialCurrencies[drawer] = [...currencies];
          initialAmounts[drawer] = {};
          for (const currency of currencies) {
            initialAmounts[drawer][currency] =
              balances[drawer]?.[currency] ?? 0;
          }
        }
        setDrawerCurrencyState(initialCurrencies);
        setBaselineCurrencies(initialCurrencies);
        setAmounts(initialAmounts);
        setLoadedBalances(balances ?? {});
        setLoaded(true);
      })
      .catch((err: unknown) => {
        logger.error("[InitialDrawerAmounts] Load error:", err);
        setLoadError(getApiErrorMessage(err, t("initial.loadFailedFallback")));
      });
  };
  useEffect(() => {
    loadDrawers();
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
    try {
      await saveAll();
    } catch (err) {
      // A thrown save (e.g. the web app losing its connection) must give the
      // button back with a message, never leave it stuck on "Saving…".
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    // Persist any newly-added currencies to currency_drawers first, so the
    // drawer's currency set stays the single source of truth. Only drawers
    // whose set grew need an update. An unrestricted drawer (General)
    // accepts every currency and has no stored list — core refuses to write
    // one — so its new currency needs nothing beyond its amount below.
    for (const drawer of visibleDrawers) {
      if (isUnrestrictedDrawer(drawer)) continue;
      const current = drawerCurrencies[drawer] ?? [];
      const baseline = baselineCurrencies[drawer] ?? [];
      const grew = current.some((c) => !baseline.includes(c));
      if (grew) {
        const res = await api.setDrawerCurrencies(drawer, current);
        if (!res.success) {
          setError(
            translateServerError(
              res,
              t,
              t("initial.addCurrencyFailed", {
                drawer: drawerText.label(drawer),
              }),
            ),
          );
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

    // No user_id: the server books the checkpoint under the signed-in user
    // on both transports (LIRA-297).
    const result = await api.createCheckpoint({
      drawer_name: "AGGREGATED",
      // i18n-exempt: stored text sent to server
      notes: "Initial drawer amounts setup",
      amounts: amountRows,
    });

    if (!result.success) {
      setError(translateServerError(result, t, t("initial.saveFailed")));
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
                {t("initial.title")}
              </h2>
              <p className="text-xs text-slate-400">{t("initial.subtitle")}</p>
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
          {loadError && (
            <div className="mb-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center justify-between gap-3">
              <p className="text-red-200 text-sm">
                {t("initial.loadFailed", { error: loadError })}
              </p>
              <button
                type="button"
                onClick={loadDrawers}
                className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 transition-colors"
              >
                {tc("actions.retry")}
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {visibleDrawers.map((drawer) => {
              const currencies = drawerCurrencies[drawer] ?? [];
              const accent = DRAWER_ACCENT[drawer] ?? "slate";
              const addable = activeCurrencies.filter(
                (c) => !currencies.includes(c.code),
              );

              return (
                <div
                  key={drawer}
                  className={`bg-slate-800/60 rounded-xl border border-slate-700/40 border-s-4 border-s-${accent}-500 px-3 py-3`}
                >
                  <span
                    className={`text-xs font-semibold text-${accent}-400 block mb-2`}
                  >
                    {drawerText.label(drawer)}
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
                      <Plus className="w-3 h-3 text-slate-500 absolute start-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <select
                        value=""
                        data-testid={`initial-drawer-add-currency-${drawer}`}
                        onChange={(e) =>
                          handleAddCurrency(drawer, e.target.value)
                        }
                        className="w-full bg-slate-900/60 border border-dashed border-slate-600 rounded-lg ps-6 pe-2 py-1.5 text-xs text-slate-400 focus:outline-none focus:border-orange-500 cursor-pointer"
                      >
                        <option value="">{t("initial.addCurrency")}</option>
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
              {t("initial.noDrawers")}
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
              {t("initial.skip")}
            </button>
            <button
              data-testid="initial-drawer-save"
              onClick={handleSave}
              disabled={saving || !loaded}
              className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {saving ? t("initial.saving") : t("initial.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

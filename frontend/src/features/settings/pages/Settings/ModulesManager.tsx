/**
 * Modules Manager
 *
 * Settings > Modules & Drawers tab — allows admins to enable/disable sidebar features,
 * view configured drawers, and manage payment methods.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import logger from "../../../../utils/logger";
import { appEvents, useApi } from "@liratek/ui";
import PaymentMethodsManager from "./PaymentMethodsManager";
import { ExportBar } from "@/shared/components/ExportBar";

interface ModuleRow {
  key: string;
  label: string;
  icon: string;
  route: string;
  sort_order: number;
  is_enabled: number;
  admin_only: number;
  is_system: number;
  enabledCurrencies?: string[];
}

/** Modules whose currencies are shown per-provider via drawer lookup */
const RECHARGE_MODULE_KEYS = new Set(["recharge", "ipec_katch"]);

/** Each recharge provider with its drawer name and parent module */
const RECHARGE_PROVIDERS = [
  { key: "MTC", label: "MTC", drawer: "MTC", module: "recharge" },
  { key: "Alfa", label: "Alfa", drawer: "Alfa", module: "recharge" },
  { key: "IPEC", label: "IPEC", drawer: "IPEC", module: "ipec_katch" },
  { key: "KATCH", label: "Katch", drawer: "Katch", module: "ipec_katch" },
  {
    key: "WISH_APP",
    label: "Whish App",
    drawer: "Whish_App",
    module: "ipec_katch",
  },
  { key: "OMT_APP", label: "OMT App", drawer: "OMT_App", module: "ipec_katch" },
  { key: "BINANCE", label: "Binance", drawer: "Binance", module: "ipec_katch" },
] as const;

interface ProviderCurrencyRow {
  key: string;
  label: string;
  drawer: string;
  module: string;
  currencies: string[];
}

export default function ModulesManager() {
  const api = useApi();
  const tableRef = useRef<HTMLTableElement>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [drawers, setDrawers] = useState<string[]>([]);
  const [providerCurrencies, setProviderCurrencies] = useState<
    ProviderCurrencyRow[]
  >([]);
  const [loading, setLoading] = useState(true);

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const [mods, drawerNames] = await Promise.all([
        api.getToggleableModules() as Promise<ModuleRow[]>,
        api.getConfiguredDrawerNames(),
      ]);

      // For non-recharge modules, fetch currencies by module
      const nonRecharge = mods.filter((m) => !RECHARGE_MODULE_KEYS.has(m.key));
      const withCurrencies = await Promise.all(
        nonRecharge.map(async (m: ModuleRow) => ({
          ...m,
          enabledCurrencies: await api
            .getCurrenciesByModule(m.key)
            .then((cs: { code: string }[]) => cs.map((c) => c.code))
            .catch(() => []),
        })),
      );

      // For recharge providers, fetch currencies per drawer
      const provRows = await Promise.all(
        RECHARGE_PROVIDERS.map(async (p) => ({
          key: p.key,
          label: p.label,
          drawer: p.drawer,
          module: p.module,
          currencies: await api
            .getFullCurrenciesByDrawer(p.drawer)
            .then((cs: { code: string }[]) => cs.map((c) => c.code))
            .catch(() => [] as string[]),
        })),
      );

      setModules(withCurrencies);
      setProviderCurrencies(provRows);
      setDrawers(drawerNames);
    } catch {
      // Keep empty if load fails
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadModules();
    const onCurrenciesChanged = () => loadModules();
    window.addEventListener("currencies-changed", onCurrenciesChanged);
    return () =>
      window.removeEventListener("currencies-changed", onCurrenciesChanged);
  }, [loadModules]);

  const handleToggle = async (key: string, currentEnabled: number) => {
    await api.setModuleEnabled(key, !currentEnabled);
    setModules((prev) =>
      prev.map((m) =>
        m.key === key ? { ...m, is_enabled: currentEnabled ? 0 : 1 } : m,
      ),
    );
    // Emit event so Sidebar re-fetches
    window.dispatchEvent(new Event("modules-changed"));
  };

  if (loading) {
    return <div className="text-slate-400">Loading modules...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">
        Enable or disable feature modules. Disabled modules are removed from the
        sidebar for all users.
      </p>
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <ExportBar
          exportExcel
          exportPdf
          exportFilename="modules"
          tableRef={tableRef}
          rowCount={modules.length + providerCurrencies.length}
        />
        <table ref={tableRef} className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="py-2 px-3">Module</th>
              <th className="py-2 px-3">Route</th>
              <th className="py-2 px-3">Enabled Currencies</th>
              <th className="py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {/* Non-recharge modules */}
            {modules.map((m) => (
              <tr key={m.key} className="border-t border-slate-800">
                <td className="py-2 px-3 text-white font-medium">{m.label}</td>
                <td className="py-2 px-3 text-slate-400 font-mono text-xs">
                  {m.route || "—"}
                </td>
                <td className="py-2 px-3 text-slate-300">
                  {m.enabledCurrencies?.length
                    ? m.enabledCurrencies.join(", ")
                    : "—"}
                </td>
                <td className="py-2 px-3">
                  <button
                    onClick={() => handleToggle(m.key, m.is_enabled)}
                    className={`px-3 py-1 rounded text-xs font-medium ${
                      m.is_enabled
                        ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                        : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                    }`}
                  >
                    {m.is_enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
              </tr>
            ))}

            {/* Recharge — single group header */}
            <tr className="border-t-2 border-slate-600 bg-slate-800/50">
              <td className="py-2 px-3 text-white font-semibold" colSpan={2}>
                Recharge
              </td>
              <td className="py-2 px-3 text-slate-400 text-xs" colSpan={2}>
                Per-provider currencies (from drawer configuration)
              </td>
            </tr>
            {providerCurrencies.map((p) => (
              <tr key={p.key} className="border-t border-slate-800/50">
                <td className="py-1.5 px-3 pl-6 text-slate-200">{p.label}</td>
                <td className="py-1.5 px-3 text-slate-500 font-mono text-xs">
                  {p.drawer}
                </td>
                <td className="py-1.5 px-3 text-slate-300">
                  {p.currencies.length ? p.currencies.join(", ") : "—"}
                </td>
                <td className="py-1.5 px-3 text-slate-500 text-xs">
                  {p.module}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 italic">
        Dashboard, Settings, Opening, and Closing are system modules and cannot
        be disabled. Recharge provider currencies are managed per drawer from
        the Currencies tab.
      </p>

      {/* Drawers Section */}
      <div className="mt-8 pt-6 border-t border-slate-700 space-y-3">
        <div>
          <h3 className="text-white font-semibold">Drawers</h3>
          <p className="text-slate-400 text-sm">
            Cash drawers tracked by the system. Drawers are created
            automatically when referenced by payment methods or modules.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {drawers.map((d) => (
            <span
              key={d}
              className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-300"
            >
              {d}
            </span>
          ))}
          {drawers.length === 0 && (
            <span className="text-slate-500 text-sm italic">
              No drawers configured
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 italic">
          Manage drawer currencies from the &quot;Currencies &amp; Rates&quot;
          tab.
        </p>
      </div>

      {/* Payment Methods Section */}
      <div className="mt-8 pt-6 border-t border-slate-700">
        <PaymentMethodsManager />
      </div>

      {/* Drawer Limits Section */}
      <div className="mt-8 pt-6 border-t border-slate-700">
        <DrawerLimitsSection />
      </div>
    </div>
  );
}

/** Drawer Limits — migrated from the old Drawer Config tab */
function DrawerLimitsSection() {
  const api = useApi();
  const [drawerLimitGeneral, setDrawerLimitGeneral] = useState("");
  const [drawerLimitOMT, setDrawerLimitOMT] = useState("");
  const [closingVarianceThresholdPct, setClosingVarianceThresholdPct] =
    useState("5");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const settings = await api.getAllSettings();
      const map = new Map(
        settings.map((s: { key_name: string; value: string }) => [
          s.key_name,
          s.value,
        ]),
      );
      setDrawerLimitGeneral((map.get("drawer_limit_general") as string) || "");
      setDrawerLimitOMT((map.get("drawer_limit_omt") as string) || "");
      setClosingVarianceThresholdPct(
        String(map.get("closing_variance_threshold_pct") ?? "5"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setIsSaving(true);
    try {
      const gen = Number(drawerLimitGeneral);
      const omt = Number(drawerLimitOMT);
      const thresholdPct = Number(closingVarianceThresholdPct);

      if (!gen || gen <= 0) throw new Error("General drawer limit must be > 0");
      if (!omt || omt <= 0) throw new Error("OMT drawer limit must be > 0");
      if (!isFinite(thresholdPct) || thresholdPct < 0 || thresholdPct > 100)
        throw new Error("Closing variance threshold must be between 0 and 100");

      await Promise.all([
        api.updateSetting("drawer_limit_general", drawerLimitGeneral),
        api.updateSetting("drawer_limit_omt", drawerLimitOMT),
        api.updateSetting(
          "closing_variance_threshold_pct",
          String(thresholdPct),
        ),
      ]);
      appEvents.emit("notification:show", "Drawer limits saved", "success");
    } catch (e) {
      logger.error("Failed to save drawer limits", { error: e });
      appEvents.emit(
        "notification:show",
        e instanceof Error ? e.message : "Failed to save",
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading)
    return (
      <div className="text-slate-400 text-sm">Loading drawer limits...</div>
    );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white font-semibold">Drawer Limits</h3>
        <p className="text-slate-400 text-sm">
          Set limits for cash drawers. Notifications will warn when balances
          exceed these limits.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="drawerLimitGeneral"
            className="block text-sm text-slate-400 mb-1"
          >
            General Drawer Limit (USD)
          </label>
          <input
            id="drawerLimitGeneral"
            type="number"
            value={drawerLimitGeneral}
            onChange={(e) => setDrawerLimitGeneral(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="drawerLimitOMT"
            className="block text-sm text-slate-400 mb-1"
          >
            OMT Drawer Limit (USD)
          </label>
          <input
            id="drawerLimitOMT"
            type="number"
            value={drawerLimitOMT}
            onChange={(e) => setDrawerLimitOMT(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="closingVarianceThresholdPct"
            className="block text-sm text-slate-400 mb-1"
          >
            Closing Variance Threshold (%)
          </label>
          <input
            id="closingVarianceThresholdPct"
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={closingVarianceThresholdPct}
            onChange={(e) => setClosingVarianceThresholdPct(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
          />
          <p className="text-xs text-slate-500 mt-1">
            Warning banner in Closing when variance exceeds this %. Set to 0 to
            disable.
          </p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={load}
          disabled={isSaving}
          className="px-3 py-1.5 rounded bg-slate-700 text-white text-sm"
        >
          Reset
        </button>
        <button
          onClick={save}
          disabled={isSaving}
          className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm"
        >
          {isSaving ? "Saving..." : "Save Limits"}
        </button>
      </div>
    </div>
  );
}

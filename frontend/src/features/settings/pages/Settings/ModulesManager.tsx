/**
 * Modules Manager
 *
 * Settings > Modules & Drawers tab — allows admins to enable/disable sidebar features,
 * view configured drawers, and manage payment methods.
 */

import { useState, useEffect } from "react";
import * as api from "../../../../api/backendApi";
import PaymentMethodsManager from "./PaymentMethodsManager";

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

export default function ModulesManager() {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [drawers, setDrawers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = async () => {
    setLoading(true);
    try {
      const [mods, drawerNames] = await Promise.all([
        api.getToggleableModules() as Promise<ModuleRow[]>,
        api.getConfiguredDrawerNames(),
      ]);
      // For each module, also fetch its enabled currencies
      const withCurrencies = await Promise.all(
        mods.map(async (m: ModuleRow) => ({
          ...m,
          enabledCurrencies: await api
            .getCurrenciesByModule(m.key)
            .then((cs: { code: string }[]) => cs.map((c) => c.code))
            .catch(() => []),
        })),
      );
      setModules(withCurrencies);
      setDrawers(drawerNames);
    } catch {
      // Keep empty if load fails
    } finally {
      setLoading(false);
    }
  };

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
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
            <tr>
              <th className="py-2 px-3">Module</th>
              <th className="py-2 px-3">Route</th>
              <th className="py-2 px-3">Enabled Currencies</th>
              <th className="py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
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
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 italic">
        Dashboard, Settings, Opening, and Closing are system modules and cannot
        be disabled. Currency assignments are managed from the Currencies tab.
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
    </div>
  );
}

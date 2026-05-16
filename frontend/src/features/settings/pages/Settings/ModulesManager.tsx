/**
 * Modules Manager
 *
 * Settings > Modules & Drawers tab — allows admins to enable/disable sidebar features,
 * view configured drawers, manage payment methods, and reorder modules via drag.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import logger from "@/utils/logger";
import { appEvents, useApi } from "@liratek/ui";
import PaymentMethodsManager from "./PaymentMethodsManager";
import { ExportBar } from "@liratek/ui";

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

/** Each recharge provider with its drawer name and parent module */
const RECHARGE_PROVIDERS = [
  { key: "MTC", label: "MTC", drawer: "MTC", module: "recharge" },
  { key: "Alfa", label: "Alfa", drawer: "Alfa", module: "recharge" },
  { key: "iPick", label: "iPick", drawer: "iPick", module: "ipec_katch" },
  { key: "Katsh", label: "Katsh", drawer: "Katsh", module: "ipec_katch" },
  {
    key: "WISH_APP",
    label: "Whish App",
    drawer: "Whish_App",
    module: "ipec_katch",
  },
  { key: "OMT_APP", label: "OMT App", drawer: "OMT_App", module: "ipec_katch" },
  { key: "BINANCE", label: "Binance", drawer: "Binance", module: "binance" },
] as const;

const RECHARGE_MODULE_KEYS = ["recharge", "ipec_katch", "binance"];

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

  // Reorder state
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const [mods, drawerNames] = await Promise.all([
        api.getToggleableModules() as Promise<ModuleRow[]>,
        api.getConfiguredDrawerNames(),
      ]);

      // Filter out removed modules (reports, transactions)
      const filteredMods = mods.filter(
        (m: ModuleRow) => !["reports", "transactions"].includes(m.key),
      );

      // Fetch currencies for ALL modules
      const withCurrencies = await Promise.all(
        filteredMods.map(async (m: ModuleRow) => ({
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

  // ── Reorder helpers ──

  const moveModule = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const updated = [...modules];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      setModules(updated);
      setSelectedKey(moved.key);

      // Persist
      setSaving(true);
      try {
        const orderedKeys = updated.map((m) => m.key);
        await api.reorderModules(orderedKeys);
        window.dispatchEvent(new Event("modules-changed"));
      } catch (e) {
        logger.error("Failed to reorder modules", { error: e });
        appEvents.emit("notification:show", "Failed to reorder", "error");
        loadModules(); // revert
      } finally {
        setSaving(false);
      }
    },
    [modules, api, loadModules],
  );

  // ── Drag handlers ──

  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
    setSelectedKey(modules[idx].key);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setOverIdx(idx);
  };

  const handleDrop = (toIdx: number) => {
    if (dragIdx !== null && dragIdx !== toIdx) {
      moveModule(dragIdx, toIdx);
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  // ── Render helpers ──

  const rechargeModuleKeys = RECHARGE_MODULE_KEYS;

  // Find the position of the first recharge module to use as the "Mobile Recharge" group position
  const firstRechargeIdx = modules.findIndex((m) =>
    rechargeModuleKeys.includes(m.key),
  );
  const rechargeModules = modules.filter((m) =>
    rechargeModuleKeys.includes(m.key),
  );

  // Build display list: non-recharge modules + a single "mobile_recharge" placeholder at the right position
  const displayModules = (() => {
    const result: Array<ModuleRow | { key: "__mobile_recharge__"; type: "group" }> = [];
    let rechargeInserted = false;
    for (const m of modules) {
      if (rechargeModuleKeys.includes(m.key)) {
        if (!rechargeInserted) {
          result.push({ key: "__mobile_recharge__", type: "group" });
          rechargeInserted = true;
        }
      } else {
        result.push(m);
      }
    }
    if (!rechargeInserted && rechargeModules.length > 0) {
      result.push({ key: "__mobile_recharge__", type: "group" });
    }
    return result;
  })();

  // Move for display list (handles the group as one unit)
  const moveDisplayModule = useCallback(
    async (fromDisplayIdx: number, toDisplayIdx: number) => {
      if (fromDisplayIdx === toDisplayIdx) return;
      const fromItem = displayModules[fromDisplayIdx];
      const isMovingRechargeGroup = "type" in fromItem && fromItem.key === "__mobile_recharge__";

      // Build new modules order
      const updated = [...modules];
      if (isMovingRechargeGroup) {
        // Remove all recharge modules, then insert them at the target position
        const rechargeItems = updated.filter((m) => rechargeModuleKeys.includes(m.key));
        const nonRecharge = updated.filter((m) => !rechargeModuleKeys.includes(m.key));

        // Find target position in nonRecharge array
        const targetItem = displayModules[toDisplayIdx];
        let insertAt: number;
        if ("type" in targetItem) {
          insertAt = nonRecharge.length; // shouldn't happen
        } else {
          insertAt = nonRecharge.findIndex((m) => m.key === targetItem.key);
          if (toDisplayIdx > fromDisplayIdx) insertAt += 1;
        }

        nonRecharge.splice(insertAt, 0, ...rechargeItems);
        setModules(nonRecharge);
        setSelectedKey("__mobile_recharge__");

        setSaving(true);
        try {
          await api.reorderModules(nonRecharge.map((m) => m.key));
          window.dispatchEvent(new Event("modules-changed"));
        } catch (e) {
          logger.error("Failed to reorder modules", { error: e });
          appEvents.emit("notification:show", "Failed to reorder", "error");
          loadModules();
        } finally {
          setSaving(false);
        }
      } else {
        // Moving a regular module
        const realFrom = modules.findIndex((m) => m.key === (fromItem as ModuleRow).key);
        // Determine real target
        const toItem = displayModules[toDisplayIdx];
        let realTo: number;
        if ("type" in toItem) {
          realTo = firstRechargeIdx >= 0 ? firstRechargeIdx : modules.length;
        } else {
          realTo = modules.findIndex((m) => m.key === toItem.key);
        }
        moveModule(realFrom, realTo);
      }
    },
    [displayModules, modules, rechargeModuleKeys, firstRechargeIdx, api, loadModules, moveModule],
  );

  // Override moveUp/moveDown to use display list
  const moveUpDisplay = useCallback(() => {
    if (!selectedKey) return;
    const displayIdx = displayModules.findIndex((d) =>
      "type" in d ? d.key === selectedKey : d.key === selectedKey,
    );
    if (displayIdx > 0) moveDisplayModule(displayIdx, displayIdx - 1);
  }, [selectedKey, displayModules, moveDisplayModule]);

  const moveDownDisplay = useCallback(() => {
    if (!selectedKey) return;
    const displayIdx = displayModules.findIndex((d) =>
      "type" in d ? d.key === selectedKey : d.key === selectedKey,
    );
    if (displayIdx < displayModules.length - 1)
      moveDisplayModule(displayIdx, displayIdx + 1);
  }, [selectedKey, displayModules, moveDisplayModule]);

  // Keyboard handler for arrow keys
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!selectedKey) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveUpDisplay();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveDownDisplay();
      } else if (e.key === "Escape") {
        setSelectedKey(null);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedKey, moveUpDisplay, moveDownDisplay]);

  const renderModuleRow = (m: ModuleRow, globalIdx: number) => {
    const isSelected = selectedKey === m.key;
    const isDragging = dragIdx !== null && modules[dragIdx]?.key === m.key;
    const isOver = overIdx !== null && modules[overIdx]?.key === m.key;

    return (
      <tr
        key={m.key}
        draggable
        onDragStart={() => handleDragStart(globalIdx)}
        onDragOver={(e) => handleDragOver(e, globalIdx)}
        onDrop={() => handleDrop(globalIdx)}
        onDragEnd={handleDragEnd}
        onClick={() => setSelectedKey(isSelected ? null : m.key)}
        className={`border-t border-slate-800 cursor-pointer transition-all duration-150 ${
          isDragging
            ? "opacity-40"
            : isOver
              ? "border-t-2 border-t-violet-500"
              : ""
        } ${
          isSelected
            ? "bg-violet-600/15 ring-1 ring-violet-500/40 scale-[1.01] z-10 relative"
            : "hover:bg-slate-800/40"
        }`}
      >
        {/* Drag handle */}
        <td className="py-2 px-2 w-8 text-slate-500 select-none">
          <span className="cursor-grab active:cursor-grabbing text-lg leading-none">
            ⠿
          </span>
        </td>
        <td className="py-2 px-3 text-white font-medium">{m.label}</td>
        <td className="py-2 px-3 text-slate-400 font-mono text-xs">
          {m.route || "—"}
        </td>
        <td className="py-2 px-3 text-slate-300">
          {m.enabledCurrencies?.length ? m.enabledCurrencies.join(", ") : "—"}
        </td>
        <td className="py-2 px-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggle(m.key, m.is_enabled);
            }}
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
    );
  };

  if (loading) {
    return <div className="text-slate-400">Loading modules...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">
          Enable or disable feature modules. Drag rows or select &amp; use arrow
          keys to reorder.
        </p>
        {selectedKey && (
          <div className="flex items-center gap-1">
            <button
              onClick={moveUpDisplay}
              disabled={saving}
              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm disabled:opacity-40"
              title="Move up (↑)"
            >
              ↑
            </button>
            <button
              onClick={moveDownDisplay}
              disabled={saving}
              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm disabled:opacity-40"
              title="Move down (↓)"
            >
              ↓
            </button>
            <button
              onClick={() => setSelectedKey(null)}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs ml-1"
            >
              Deselect
            </button>
            {saving && (
              <span className="text-xs text-slate-500 ml-2">Saving...</span>
            )}
          </div>
        )}
      </div>
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
              <th className="py-2 px-2 w-8"></th>
              <th className="py-2 px-3">Module</th>
              <th className="py-2 px-3">Route</th>
              <th className="py-2 px-3">Enabled Currencies</th>
              <th className="py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {/* Dashboard — always at top */}
            <tr className="border-t border-slate-800 bg-slate-800/10">
              <td className="py-2 px-2 w-8"></td>
              <td className="py-2 px-3 text-white font-medium">Dashboard</td>
              <td className="py-2 px-3 text-slate-400 font-mono text-xs">/</td>
              <td className="py-2 px-3 text-slate-300">—</td>
              <td className="py-2 px-3">
                <span className="px-3 py-1 rounded text-xs font-medium bg-slate-600/20 text-slate-400">System</span>
              </td>
            </tr>

            {/* Toggleable modules */}
            {displayModules.flatMap((item, displayIdx) => {
              if ("type" in item && item.key === "__mobile_recharge__") {
                // Render "Mobile Recharge" as a single draggable group row
                const isSelected = selectedKey === "__mobile_recharge__";
                const isDragging =
                  dragIdx !== null &&
                  modules[dragIdx] &&
                  rechargeModuleKeys.includes(modules[dragIdx].key);
                const allEnabled = rechargeModules.every((m) => m.is_enabled);
                const anyEnabled = rechargeModules.some((m) => m.is_enabled);

                return [
                  <tr
                    key="__mobile_recharge__"
                    draggable
                    onDragStart={() => {
                      setDragIdx(firstRechargeIdx);
                      setSelectedKey("__mobile_recharge__");
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverIdx(firstRechargeIdx);
                    }}
                    onDrop={() => {
                      if (dragIdx !== null) {
                        const fromDisplayIdx = displayModules.findIndex((d) =>
                          "type" in d
                            ? d.key === modules[dragIdx]?.key || rechargeModuleKeys.includes(modules[dragIdx]?.key)
                            : d.key === modules[dragIdx]?.key,
                        );
                        if (fromDisplayIdx !== displayIdx) {
                          moveDisplayModule(fromDisplayIdx, displayIdx);
                        }
                      }
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                    onDragEnd={handleDragEnd}
                    onClick={() =>
                      setSelectedKey(isSelected ? null : "__mobile_recharge__")
                    }
                    className={`border-t border-slate-800 cursor-pointer transition-all duration-150 ${
                      isDragging ? "opacity-40" : ""
                    } ${
                      isSelected
                        ? "bg-violet-600/15 ring-1 ring-violet-500/40 scale-[1.01] z-10 relative"
                        : "hover:bg-slate-800/40"
                    }`}
                  >
                    <td className="py-2 px-2 w-8 text-slate-500 select-none">
                      <span className="cursor-grab active:cursor-grabbing text-lg leading-none">
                        ⠿
                      </span>
                    </td>
                    <td className="py-2 px-3 text-white font-semibold">
                      Mobile Recharge
                    </td>
                    <td className="py-2 px-3 text-slate-400 font-mono text-xs">
                      /recharge
                    </td>
                    <td className="py-2 px-3 text-slate-300 text-xs">
                      {providerCurrencies
                        .map((p) => `${p.label}: ${p.currencies.join("/")}`)
                        .join(" · ") || "—"}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-3 py-1 rounded text-xs font-medium ${
                          allEnabled
                            ? "bg-green-600/20 text-green-400"
                            : anyEnabled
                              ? "bg-amber-600/20 text-amber-400"
                              : "bg-red-600/20 text-red-400"
                        }`}
                      >
                        {allEnabled
                          ? "All Enabled"
                          : anyEnabled
                            ? "Partial"
                            : "All Disabled"}
                      </span>
                    </td>
                  </tr>,
                  // Sub-rows for each recharge module (always visible, not draggable)
                  ...rechargeModules.map((m) => {
                    const providers = RECHARGE_PROVIDERS.filter(
                      (p) => p.module === m.key,
                    );
                    const prov = providerCurrencies.filter(
                      (p) => p.module === m.key,
                    );
                    return (
                      <tr
                        key={m.key}
                        className="border-t-2 border-slate-600 bg-slate-800/10"
                      >
                        <td className="py-1.5 px-2 w-8"></td>
                        <td className="py-1.5 px-3 pl-8 text-slate-300 text-sm">
                          {m.label}
                        </td>
                        <td className="py-1.5 px-3 text-slate-500 font-mono text-xs">
                          {providers.map((p) => p.drawer).join(", ")}
                        </td>
                        <td className="py-1.5 px-3 text-slate-400 text-xs">
                          {prov
                            .map(
                              (p) => `${p.label}: ${p.currencies.join("/")}`,
                            )
                            .join(" · ") || "—"}
                        </td>
                        <td className="py-1.5 px-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggle(m.key, m.is_enabled);
                            }}
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              m.is_enabled
                                ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                                : "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                            }`}
                          >
                            {m.is_enabled ? "Enabled" : "Disabled"}
                          </button>
                        </td>
                      </tr>
                    );
                  }),
                ];
              }

              // Regular module row
              const m = item as ModuleRow;
              const globalIdx = modules.findIndex((mod) => mod.key === m.key);
              return [renderModuleRow(m, globalIdx)];
            })}

            {/* System modules — always at bottom */}
            <tr className="border-t-2 border-slate-600 bg-slate-800/10">
              <td className="py-2 px-2 w-8"></td>
              <td className="py-2 px-3 text-white font-medium">Audit & Transactions</td>
              <td className="py-2 px-3 text-slate-400 font-mono text-xs">/audit</td>
              <td className="py-2 px-3 text-slate-300">—</td>
              <td className="py-2 px-3">
                <span className="px-3 py-1 rounded text-xs font-medium bg-slate-600/20 text-slate-400">System</span>
              </td>
            </tr>
            <tr className="border-t border-slate-800 bg-slate-800/10">
              <td className="py-2 px-2 w-8"></td>
              <td className="py-2 px-3 text-white font-medium">Settings</td>
              <td className="py-2 px-3 text-slate-400 font-mono text-xs">/settings</td>
              <td className="py-2 px-3 text-slate-300">—</td>
              <td className="py-2 px-3">
                <span className="px-3 py-1 rounded text-xs font-medium bg-slate-600/20 text-slate-400">System</span>
              </td>
            </tr>
            <tr className="border-t border-slate-800 bg-slate-800/10">
              <td className="py-2 px-2 w-8"></td>
              <td className="py-2 px-3 text-white font-medium">Checkpoint</td>
              <td className="py-2 px-3 text-slate-400 font-mono text-xs">—</td>
              <td className="py-2 px-3 text-slate-300">—</td>
              <td className="py-2 px-3">
                <span className="px-3 py-1 rounded text-xs font-medium bg-slate-600/20 text-slate-400">System</span>
              </td>
            </tr>
            <tr className="border-t border-slate-800 bg-slate-800/10">
              <td className="py-2 px-2 w-8"></td>
              <td className="py-2 px-3 text-white font-medium">Checkpoint Timeline</td>
              <td className="py-2 px-3 text-slate-400 font-mono text-xs">/checkpoint-timeline</td>
              <td className="py-2 px-3 text-slate-300">—</td>
              <td className="py-2 px-3">
                <span className="px-3 py-1 rounded text-xs font-medium bg-slate-600/20 text-slate-400">System</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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

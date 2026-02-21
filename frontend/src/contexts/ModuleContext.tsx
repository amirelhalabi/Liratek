/**
 * Module Context
 *
 * Provides application-wide module data loaded from the database.
 * Controls sidebar navigation dynamically based on enabled modules.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useApi } from "@liratek/ui";

export interface ModuleInfo {
  key: string;
  label: string;
  icon: string;
  route: string;
  sort_order: number;
  is_enabled: number;
  admin_only: number;
  is_system: number;
}

interface ModuleContextValue {
  allModules: ModuleInfo[];
  enabledModules: ModuleInfo[];
  isModuleEnabled: (key: string) => boolean;
  refreshModules: () => Promise<void>;
}

const ModuleContext = createContext<ModuleContextValue | null>(null);

export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const [allModules, setAllModules] = useState<ModuleInfo[]>([]);

  const loadModules = useCallback(async () => {
    try {
      const mods = await api.getEnabledModules();
      setAllModules(Array.isArray(mods) ? (mods as ModuleInfo[]) : []);
    } catch {
      // Fallback: keep existing modules if API fails
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial data fetch
    loadModules();
    // Listen for changes from Settings > Modules
    const handler = () => loadModules();
    window.addEventListener("modules-changed", handler);
    return () => window.removeEventListener("modules-changed", handler);
  }, [loadModules]);

  const enabledModules = allModules.filter((m) => m.is_enabled);

  const isModuleEnabled = useCallback(
    (key: string) => enabledModules.some((m) => m.key === key),
    [enabledModules],
  );

  return (
    <ModuleContext.Provider
      value={{
        allModules,
        enabledModules,
        isModuleEnabled,
        refreshModules: loadModules,
      }}
    >
      {children}
    </ModuleContext.Provider>
  );
}

export const useModules = () => {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error("useModules must be used within ModuleProvider");
  return ctx;
};

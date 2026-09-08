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
  useRef,
} from "react";
import { useApi } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";

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
  const { isAuthenticated } = useAuth();

  // Read `api` through a ref so the loader keeps a STABLE identity.
  //
  // The loader is depended on by the effect below, so if its identity
  // churned every render the effect would re-fire, set state, re-render, and
  // loop forever. `ApiProvider` happens to pass a module-level singleton in
  // production, which hides this — but that is an implicit contract the
  // provider does not enforce, and it already caused a real infinite loop
  // once (see CurrencyContext.authGate.test.tsx, which deliberately mocks
  // useApi() with an unstable identity to keep that regression covered).
  //
  // The ref is reassigned every render, so `.current` is always current when
  // the callback actually runs — stable identity, no stale closure.
  const apiRef = useRef(api);
  apiRef.current = api;
  const [allModules, setAllModules] = useState<ModuleInfo[]>([]);

  const loadModules = useCallback(async () => {
    try {
      const mods = await apiRef.current.getEnabledModules();
      setAllModules(Array.isArray(mods) ? (mods as ModuleInfo[]) : []);
    } catch {
      // Fallback: keep existing modules if API fails
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef.current is read at call time, not captured; no dep needed
  }, []);

  // Gate the load on auth and re-run on the false -> true transition.
  //
  // Without this, a cold login fetched before the JWT existed, got rejected,
  // cached an empty result and never retried -- so the first render after
  // signing in was half-empty (sidebar showing only Checkpoint Timeline,
  // Drawer Balances showing one card of ten) and a plain reload fixed it,
  // because by then the token was already in localStorage.
  //
  // Web-only by construction, which is why it went unnoticed: over IPC the
  // renderer never needed a JWT, so an early fetch always succeeded. Same
  // gate CurrencyContext and MobileServiceItemsProvider already use.
  useEffect(() => {
    if (!isAuthenticated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial data fetch
    loadModules();
    // Listen for changes from Settings > Modules
    const handler = () => loadModules();
    window.addEventListener("modules-changed", handler);
    return () => window.removeEventListener("modules-changed", handler);
  }, [loadModules, isAuthenticated]);

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

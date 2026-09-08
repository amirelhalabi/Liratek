/**
 * Feature Flag Context
 *
 * Provides feature flag values loaded from system_settings.
 * Currently manages:
 *   - feature_session_management  (show/hide Opening & Closing)
 *   - feature_customer_sessions   (show/hide customer session floating button)
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

interface FeatureFlags {
  sessionManagement: boolean;
  customerSessions: boolean;
}

interface FeatureFlagContextValue {
  flags: FeatureFlags;
  refreshFlags: () => Promise<void>;
}

const DEFAULT_FLAGS: FeatureFlags = {
  sessionManagement: true,
  customerSessions: true,
};

const FeatureFlagContext = createContext<FeatureFlagContextValue>({
  flags: DEFAULT_FLAGS,
  refreshFlags: async () => {},
});

export function FeatureFlagProvider({
  children,
}: {
  children: React.ReactNode;
}) {
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
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);

  const refreshFlags = useCallback(async () => {
    try {
      const settings = await apiRef.current.getAllSettings();
      const map = new Map<string, string>(
        settings.map((s: { key_name: string; value: string }) => [
          s.key_name,
          s.value,
        ]),
      );
      setFlags({
        sessionManagement: map.get("feature_session_management") !== "disabled",
        customerSessions: map.get("feature_customer_sessions") !== "disabled",
      });
    } catch {
      // Keep defaults on error
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef.current is read at call time, not captured; no dep needed
  }, []);

  // Gate the load on auth and re-run on the false -> true transition.
  //
  // Without this, a cold login fetched before the JWT existed, got rejected,
  // kept the default flags and never retried -- so features that gate on a
  // flag (customer sessions, session management) stayed off until a reload.
  // Same class of bug as the sidebar rendering half-empty after login.
  //
  // Web-only by construction: over IPC the renderer never needed a JWT, so an
  // early fetch always succeeded. Same gate CurrencyContext and
  // MobileServiceItemsProvider already use.
  useEffect(() => {
    if (!isAuthenticated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshFlags();
    const handler = () => refreshFlags();
    window.addEventListener("feature-flags-changed", handler);
    return () => window.removeEventListener("feature-flags-changed", handler);
  }, [refreshFlags, isAuthenticated]);

  return (
    <FeatureFlagContext.Provider value={{ flags, refreshFlags }}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagContext);
}

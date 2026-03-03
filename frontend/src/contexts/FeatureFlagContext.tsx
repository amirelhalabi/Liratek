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
} from "react";
import { useApi } from "@liratek/ui";

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
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);

  const refreshFlags = useCallback(async () => {
    try {
      const settings = await api.getAllSettings();
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
  }, [api]);

  useEffect(() => {
    refreshFlags();
    const handler = () => refreshFlags();
    window.addEventListener("feature-flags-changed", handler);
    return () => window.removeEventListener("feature-flags-changed", handler);
  }, [refreshFlags]);

  return (
    <FeatureFlagContext.Provider value={{ flags, refreshFlags }}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagContext);
}

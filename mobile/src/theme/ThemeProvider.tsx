import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, useColorScheme } from "react-native";

import { dark, light, type Palette } from "./tokens";

/** What the owner picks in Settings. "system" follows the phone's own mode. */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedScheme = "light" | "dark";

interface ThemeState {
  palette: Palette;
  scheme: ResolvedScheme;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const PREFERENCE_KEY = "liratek.theme";

const ThemeContext = createContext<ThemeState>({
  palette: dark,
  scheme: "dark",
  preference: "system",
  setPreference: () => undefined,
});

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Light / dark / system, chosen in Settings and remembered on the phone.
 *
 * The choice is also pushed to React Native's Appearance, so native pieces
 * (keyboard, alerts, the status bar) match the app. "unspecified" hands the
 * decision back to the phone. When the phone reports no mode at all, the app
 * falls back to dark, the web app's default.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const systemScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    void SecureStore.getItemAsync(PREFERENCE_KEY).then((stored) => {
      if (!cancelled && isPreference(stored)) setPreferenceState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void SecureStore.setItemAsync(PREFERENCE_KEY, next);
  }, []);

  const scheme: ResolvedScheme =
    preference === "system" ? (systemScheme === "light" ? "light" : "dark") : preference;

  const value = useMemo<ThemeState>(
    () => ({ palette: scheme === "light" ? light : dark, scheme, preference, setPreference }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The colours for the current mode. */
export function useTheme(): Palette {
  return useContext(ThemeContext).palette;
}

/** The Settings choice and the mode it resolves to. */
export function useThemePreference(): Omit<ThemeState, "palette"> {
  const { scheme, preference, setPreference } = useContext(ThemeContext);
  return { scheme, preference, setPreference };
}

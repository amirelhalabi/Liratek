import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/theme/ThemeProvider";

/** The Settings tab's page stack: no header (the page starts below the clock). */
export default function SettingsLayout() {
  const t = useTheme();
  // Main tab pages have no header (owner 2026-10-11): start below the clock instead.
  const insets = useSafeAreaInsets();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "transparent" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings", headerShown: false, contentStyle: { backgroundColor: "transparent", paddingTop: insets.top } }} />
    </Stack>
  );
}

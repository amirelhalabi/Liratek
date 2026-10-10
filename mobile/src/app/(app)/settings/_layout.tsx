import { Stack } from "expo-router";

import { useTheme } from "@/theme/ThemeProvider";

/** The Settings tab's page stack: gives the native tab its themed title bar. */
export default function SettingsLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "transparent" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
    </Stack>
  );
}

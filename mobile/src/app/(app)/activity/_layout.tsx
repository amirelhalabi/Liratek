import { Stack } from "expo-router";

import { useTheme } from "@/theme/ThemeProvider";

/** The Activity tab's page stack: gives the native tab its themed title bar. */
export default function ActivityLayout() {
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
      <Stack.Screen name="index" options={{ title: "Activity" }} />
    </Stack>
  );
}

import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConnectionGate } from "@/components/ConnectionGate";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";

/** The Activity tab's page stack: no header on the list (it starts below the clock); the detail sheet has its own. */
export default function ActivityLayout() {
  const t = useTheme();
  // Main tab pages have no header (owner 2026-10-11): start below the clock instead.
  const insets = useSafeAreaInsets();
  return (
    <ConnectionGate>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Activity", headerShown: false, contentStyle: { backgroundColor: "transparent", paddingTop: insets.top } }} />
        {/* Native bottom sheet: the system fades the background and slides only
            the sheet, and a drag down closes it. */}
        <Stack.Screen
          name="[id]"
          options={{
            presentation: "formSheet",
            sheetAllowedDetents: "fitToContents",
            sheetGrabberVisible: true,
            sheetCornerRadius: radius.xxl,
            headerShown: false,
            contentStyle: { backgroundColor: t.card },
          }}
        />
      </Stack>
    </ConnectionGate>
  );
}

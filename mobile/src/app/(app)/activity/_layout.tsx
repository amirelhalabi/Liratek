import { Stack } from "expo-router";

import { ConnectionGate } from "@/components/ConnectionGate";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";

/** The Activity tab's page stack: gives the native tab its themed title bar. */
export default function ActivityLayout() {
  const t = useTheme();
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
        <Stack.Screen name="index" options={{ title: "Activity" }} />
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

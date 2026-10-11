import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConnectionGate } from "@/components/ConnectionGate";
import { useModuleGates } from "@/data/useModuleGates";
import { useTheme } from "@/theme/ThemeProvider";
import { sellTabVisible } from "@/utils/moduleGates";

// The list is always the page under a detail page, even when the detail page
// is opened directly (a link): Back and tapping the tab again return to it.
export const unstable_settings = { initialRouteName: "index" };

/** The Sell tab's own page stack (LIRA-300): its detail page keeps the tab bar and its state. */
export default function SellLayout() {
  const t = useTheme();
  // Main tab pages have no header (owner 2026-10-11): start below the clock instead.
  const insets = useSafeAreaInsets();
  const gates = useModuleGates();
  // While the tab is hidden, drop its pages so a half-filled sale is not kept (LIRA-307).
  if (!sellTabVisible(gates)) return null;
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
        <Stack.Screen name="index" options={{ title: "Sell", headerShown: false, contentStyle: { backgroundColor: "transparent", paddingTop: insets.top } }} />
        <Stack.Screen name="[provider]" options={{ title: "Record a sale" }} />
        <Stack.Screen name="catalog/[provider]" options={{ title: "Catalog" }} />
      </Stack>
    </ConnectionGate>
  );
}

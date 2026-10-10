import { Stack } from "expo-router";

import { useTheme } from "@/theme/ThemeProvider";

// The list is always the page under a detail page, even when the detail page
// is opened directly (a link): Back and tapping the tab again return to it.
export const unstable_settings = { initialRouteName: "index" };

/** The Sell tab's own page stack (LIRA-300): its detail page keeps the tab bar and its state. */
export default function SellLayout() {
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
      <Stack.Screen name="index" options={{ title: "Sell" }} />
      <Stack.Screen name="[provider]" options={{ title: "Record a sale" }} />
      <Stack.Screen name="catalog/[provider]" options={{ title: "Catalog" }} />
    </Stack>
  );
}

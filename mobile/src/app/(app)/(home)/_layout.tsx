import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth/AuthContext";
import { ConnectionGate } from "@/components/ConnectionGate";
import { useTheme } from "@/theme/ThemeProvider";

/** The Home tab's page stack: no header (the page starts below the clock). */
export default function HomeLayout() {
  const t = useTheme();
  // Main tab pages have no header (owner 2026-10-11): start below the clock instead.
  const insets = useSafeAreaInsets();
  const { shop } = useAuth();
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
        <Stack.Screen name="index" options={{ title: shop?.name ?? "LiraTek", headerShown: false, contentStyle: { backgroundColor: "transparent", paddingTop: insets.top } }} />
      </Stack>
    </ConnectionGate>
  );
}

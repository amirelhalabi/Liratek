import { Stack } from "expo-router";

import { PageBackground } from "@/components/PageBackground";
import { useTheme } from "@/theme/ThemeProvider";

export default function AppLayout() {
  const t = useTheme();
  return (
    <PageBackground>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </PageBackground>
  );
}

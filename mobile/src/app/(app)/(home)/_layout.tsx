import { Stack } from "expo-router";

import { useAuth } from "@/auth/AuthContext";
import { useTheme } from "@/theme/ThemeProvider";

/** The Home tab's page stack: the same themed title bar as every other tab, titled with the shop's name. */
export default function HomeLayout() {
  const t = useTheme();
  const { shop } = useAuth();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "transparent" },
      }}
    >
      <Stack.Screen name="index" options={{ title: shop?.name ?? "LiraTek" }} />
    </Stack>
  );
}

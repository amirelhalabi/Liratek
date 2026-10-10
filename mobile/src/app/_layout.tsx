import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, AppState, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { queryClient } from "@/data/queryClient";
import { ThemeProvider, useTheme, useThemePreference } from "@/theme/ThemeProvider";

// React Native has no window focus: coming back from the background counts as
// focus, so stale data refreshes when the owner reopens the app (LIRA-300 R5).
focusManager.setEventListener((setFocused) => {
  if (Platform.OS === "web") return undefined;
  const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
  return () => sub.remove();
});

function ThemedStatusBar() {
  const { scheme } = useThemePreference();
  return <StatusBar style={scheme === "dark" ? "light" : "dark"} />;
}

function Gate() {
  const { status } = useAuth();
  const t = useTheme();

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.page }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const signedIn = status === "signedIn";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.page } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemedStatusBar />
            <Gate />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

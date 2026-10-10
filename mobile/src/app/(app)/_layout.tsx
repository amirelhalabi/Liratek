import { Tabs } from "expo-router";
import { History, House, Send, Settings, Users } from "lucide-react-native";

import { PageBackground } from "@/components/PageBackground";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Signed-in app: one tab per section (LIRA-300). Sell and Debts hold their own
 * Stack, so the transfer form and the customer page keep the tab bar and their
 * state while another tab is shown; tapping the active tab again returns to
 * its first page.
 */
export default function AppLayout() {
  const t = useTheme();
  return (
    <PageBackground>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
          headerShadowVisible: false,
          sceneStyle: { backgroundColor: "transparent" },
          tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
          tabBarActiveTintColor: t.accent,
          tabBarInactiveTintColor: t.textMuted,
          tabBarHideOnKeyboard: true,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Home", headerShown: false, tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="sell"
          options={{ title: "Sell", headerShown: false, tabBarIcon: ({ color, size }) => <Send color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="debts"
          options={{ title: "Debts", headerShown: false, tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="activity"
          options={{ title: "Activity", tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }}
        />
      </Tabs>
    </PageBackground>
  );
}

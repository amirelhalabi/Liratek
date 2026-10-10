import { NativeTabs } from "expo-router/unstable-native-tabs";

import { PageBackground } from "@/components/PageBackground";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Signed-in app: one tab per section (LIRA-300), drawn by the system's own
 * tab bar — on iOS 26 Apple's floating Liquid Glass bar (it shrinks while
 * scrolling), on older iOS the standard translucent bar, on Android the
 * Material bottom bar. Each tab holds its own page stack, so detail pages keep
 * the bar and their state, and tapping the active tab returns to its first page.
 */
export default function AppLayout() {
  const t = useTheme();
  // The native tab container is opaque: give it the app's page colour (a
  // transparent one shows black on iOS, not the gradient behind it).
  const content = { backgroundColor: t.page };
  return (
    <PageBackground>
      <NativeTabs tintColor={t.accent} minimizeBehavior="onScrollDown">
        <NativeTabs.Trigger name="index" contentStyle={content}>
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="sell" contentStyle={content}>
          <NativeTabs.Trigger.Label>Sell</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "paperplane", selected: "paperplane.fill" }} md="send" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="debts" contentStyle={content}>
          <NativeTabs.Trigger.Label>Debts</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} md="group" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="activity" contentStyle={content}>
          <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" md="history" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings" contentStyle={content}>
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} md="settings" />
        </NativeTabs.Trigger>
      </NativeTabs>
    </PageBackground>
  );
}

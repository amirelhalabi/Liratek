import { router, useSegments } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect } from "react";

import { PageBackground } from "@/components/PageBackground";
import { useModuleGates } from "@/data/useModuleGates";
import { useTheme } from "@/theme/ThemeProvider";
import { debtsTabVisible, sellTabVisible } from "@/utils/moduleGates";

/**
 * Signed-in app: one tab per section (LIRA-300), drawn by the system's own
 * tab bar — on iOS 26 Apple's floating Liquid Glass bar (it shrinks while
 * scrolling), on older iOS the standard translucent bar, on Android the
 * Material bottom bar. Each tab holds its own page stack, so detail pages keep
 * the bar and their state, and tapping the active tab returns to its first page.
 *
 * Tabs a switched-off module owns are hidden (LIRA-307), the same switches as
 * the web's Settings → Modules; until the phone has checked them in this run,
 * they stay hidden.
 */
export default function AppLayout() {
  const t = useTheme();
  // The native tab container is opaque: give it the app's page colour (a
  // transparent one shows black on iOS, not the gradient behind it).
  const content = { backgroundColor: t.page };
  const gates = useModuleGates();
  const visible: Record<string, boolean> = { sell: sellTabVisible(gates), debts: debtsTabVisible(gates) };
  useLeaveHiddenTab(visible);
  return (
    <PageBackground>
      <NativeTabs tintColor={t.accent} minimizeBehavior="onScrollDown">
        <NativeTabs.Trigger name="(home)" contentStyle={content}>
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="sell" contentStyle={content} hidden={!visible.sell}>
          <NativeTabs.Trigger.Label>Sell</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={{ default: "paperplane", selected: "paperplane.fill" }} md="send" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="debts" contentStyle={content} hidden={!visible.debts}>
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

/** If the tab on screen gets hidden (a switch turned off), go to Home (LIRA-307 FR-007). */
function useLeaveHiddenTab(visible: Record<string, boolean>) {
  const segments = useSegments() as string[];
  // segments[0] is "(app)"; segments[1] is the tab's folder.
  const tab = segments[1];
  const hidden = tab !== undefined && visible[tab] === false;
  useEffect(() => {
    if (hidden) router.replace("/");
  }, [hidden]);
}

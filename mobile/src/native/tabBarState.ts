import { requireOptionalNativeModule } from "expo";
import { useSyncExternalStore } from "react";
import { LayoutAnimation } from "react-native";

type DockState = { minimized: boolean; centerFromBottom: number };
type TabBarStateModule = {
  addListener(
    event: "onChange",
    fn: (e: DockState) => void,
  ): { remove(): void };
};

/** iOS-only local module (modules/tab-bar-state). Null on Android and on builds without it. */
const native = requireOptionalNativeModule<TabBarStateModule>("TabBarState");

const EXPANDED: DockState = { minimized: false, centerFromBottom: 0 };
let current = EXPANDED;
const listeners = new Set<() => void>();
let subscription: { remove(): void } | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  // One native listener for every screen that asks; the module only runs its
  // frame loop while someone listens.
  if (native && !subscription) {
    subscription = native.addListener("onChange", (e) => {
      // Anything placed by the dock state moves with the dock.
      if (e.minimized !== current.minimized)
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      current = e;
      listeners.forEach((l) => l());
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
      current = EXPANDED;
    }
  };
}

/**
 * The system tab bar's real state, read from the native bar itself: whether
 * iOS 26 has minimized it to a single button, and where that button's centre
 * sits above the screen's bottom edge (0 until known). Always expanded on
 * Android and older iOS, where the bar never minimizes.
 */
export function useDockState(): DockState {
  return useSyncExternalStore(subscribe, () => current);
}

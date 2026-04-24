import { useEffect } from "react";

/**
 * Hook that calls window.api.display.fixFocus() when a modal unmounts.
 *
 * Workaround for a known Chromium/Electron bug on Windows where removing a
 * `backdrop-filter: blur()` overlay causes the compositor to lose input focus
 * on the underlying page.  Even though we've removed backdrop-blur from modal
 * overlays, this hook provides belt-and-suspenders protection by explicitly
 * cycling BrowserWindow.blur() / .focus() on cleanup.
 *
 * Usage:  call `useModalFocusFix(isOpen)` at the top of every modal component.
 */
export function useModalFocusFix(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;

    // Only apply the blur/focus workaround on Windows where the Chromium
    // compositor bug actually occurs.  On macOS, win.blur() deactivates the
    // window causing a visible flash, which is worse than the bug itself.
    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;

    // When the modal closes (isOpen goes false → effect cleanup runs),
    // nudge the Electron window focus.
    return () => {
      try {
        window.api?.display?.fixFocus?.();
      } catch {
        // Silently ignore — non-Electron environments or missing binding.
      }
    };
  }, [isOpen]);
}

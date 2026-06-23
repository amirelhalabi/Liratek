import { useEffect, useRef } from "react";

/**
 * Workaround for a known Chromium/Electron compositor bug on Windows where
 * fixed overlays can cause the renderer to drop keyboard focus.
 *
 * - On **open**: listens for mousedown inside the modal and re-focuses the
 *   window if the active element doesn't match the click target. This catches
 *   the case where clicking an input field visually selects it but the
 *   compositor never delivers key events.
 * - On **close**: cycles BrowserWindow.blur()/.focus() to restore focus to the
 *   page underneath.
 *
 * Usage:  call `useModalFocusFix(isOpen)` at the top of every modal component.
 */
export function useModalFocusFix(isOpen: boolean): void {
  const fixedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        requestAnimationFrame(() => {
          if (document.activeElement !== target) {
            target.focus();
          }
          if (!fixedRef.current) {
            fixedRef.current = true;
            try {
              window.api?.display?.fixFocus?.();
            } catch {
              /* ignore */
            }
          }
        });
      }
    }

    document.addEventListener("mousedown", handleMouseDown, true);
    fixedRef.current = false;

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);

      // fixFocus must run AFTER the modal DOM is removed, not before.
      // Calling it synchronously here fires while the fixed overlay is still
      // in the DOM (React hasn't re-rendered yet), so the compositor stays
      // confused. A small delay lets React commit the unmount first.
      let postCloseTimer: ReturnType<typeof setTimeout> | null = null;

      function handlePostCloseMouseDown(e: MouseEvent) {
        if (postCloseTimer !== null) clearTimeout(postCloseTimer);
        document.removeEventListener(
          "mousedown",
          handlePostCloseMouseDown,
          true,
        );
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          try {
            window.api?.display?.fixFocus?.();
          } catch {
            /* ignore */
          }
          requestAnimationFrame(() => {
            if (document.activeElement !== target) target.focus();
          });
        }
      }

      document.addEventListener("mousedown", handlePostCloseMouseDown, true);

      // Fallback: if the user doesn't click within 300 ms, cycle focus anyway
      // so the window is unambiguously active for keyboard input.
      postCloseTimer = setTimeout(() => {
        document.removeEventListener(
          "mousedown",
          handlePostCloseMouseDown,
          true,
        );
        try {
          window.api?.display?.fixFocus?.();
        } catch {
          /* ignore */
        }
      }, 300);
    };
  }, [isOpen]);
}

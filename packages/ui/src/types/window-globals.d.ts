/**
 * Global window augmentations shared by the renderer (`frontend/`) and the
 * shared UI package (`packages/ui/`). This is the ONE copy: packages/ui picks
 * it up through its `src` include, and every frontend tsconfig that needs it
 * (tsconfig.app.json, tsconfig.test.json, tsconfig.playwright.json) lists this
 * path explicitly.
 *
 * `Window.api` is deliberately NOT declared here. Its type (`ElectronAPI`)
 * lives in `frontend/src/types/electron.d.ts`, which already owns the
 * `Window.api` global; packages/ui must not depend on frontend types, and a
 * second declaration would have to agree with that one exactly. UI code that
 * needs a slice of the preload bridge types that slice structurally (see
 * `hooks/useModalFocusFix.ts`).
 *
 * Keep these minimal and UI-focused to avoid coupling renderer code to
 * Electron main internals.
 */
export {};

declare global {
  /** Injected by Vite's `define` (frontend/vite.config.ts). */
  const __APP_VERSION__: string;

  type UINotificationHistoryItem = {
    id: string | number;
    message: string;
    type: "success" | "error" | "info" | "warning";
    duration?: number;
  };

  interface Window {
    /** Current logged-in user id (used by Closing flows) */
    currentUserId?: number;

    /** Most recent notification history (limited to last N items by NotificationCenter) */
    notificationHistory?: UINotificationHistoryItem[];

    /**
     * e2e-only override: collapses NotificationCenter's auto-dismiss timer so
     * toasts stop overlaying/intercepting clicks in specs that opt in. Must
     * never be set by app code.
     */
    __e2eNotificationDurationMs?: number;
  }
}

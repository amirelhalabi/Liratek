import type { ElectronAPI } from "./electron";

/**
 * Global window augmentations used by the renderer.
 *
 * Keep these minimal and UI-focused to avoid coupling renderer code to Electron main internals.
 */
export {};

declare global {
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

    /** Preload API (Electron only) */
    api?: ElectronAPI;
  }
}

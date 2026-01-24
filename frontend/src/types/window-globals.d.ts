import type { ElectronAPI } from "./electron";

/**
 * Global window augmentations used by the renderer.
 *
 * Keep these minimal and UI-focused to avoid coupling renderer code to Electron main internals.
 */
export {};

declare global {
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

    /** Preload API (Electron only) */
    api?: ElectronAPI;
  }
}

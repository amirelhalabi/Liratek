export {};

declare global {
  type UINotificationHistoryItem = {
    id: string | number;
    message: string;
    type: "success" | "error" | "info" | "warning";
    duration?: number;
  };

  interface Window {
    notificationHistory?: UINotificationHistoryItem[];

    /**
     * e2e-only override: collapses NotificationCenter's auto-dismiss timer so
     * toasts stop overlaying/intercepting clicks in specs that opt in. Must
     * never be set by app code.
     */
    __e2eNotificationDurationMs?: number;
  }
}

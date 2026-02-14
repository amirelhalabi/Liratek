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
  }
}

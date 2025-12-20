// Event emitter for app-wide events
// Keep a minimal typed core with a generic fallback (no `any`)
export type NotificationType = "success" | "error" | "info" | "warning";

// Minimal UI notification shape to type history events (avoid coupling to UI files)
export type UINotification = {
  id: string; // align with NotificationCenter
  message: string;
  type: NotificationType;
  duration?: number;
};

// Map of known events to their argument tuples
type EventMap = {
  "notification:show": [
    message: string,
    type: NotificationType,
    duration?: number,
  ];
  "notification:history": [history: UINotification[]];
  "sale:completed": [data?: unknown];
  "debt:repayment": [data?: unknown];
  "inventory:updated": [data?: unknown];
  openClosingModal: [];
  openOpeningModal: [];
  "closing:confirmed": [];
  "closing:completed": [];
};

class AppEventEmitter {
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  on<K extends keyof EventMap>(
    event: K,
    callback: (...args: EventMap[K]) => void,
  ): () => void;
  // Fallback for custom/temporary events (typed as unknown[] to avoid `any`)
  on(event: string, callback: (...args: unknown[]) => void): () => void;
  on(event: string, callback: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: (...args: unknown[]) => void) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void;
  // Fallback emit
  emit(event: string, ...args: unknown[]): void;
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((callback) => callback(...args));
  }
}

export const appEvents = new AppEventEmitter();

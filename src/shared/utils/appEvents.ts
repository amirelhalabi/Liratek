// Event emitter for app-wide events
// Event emitter for app-wide events
type NotificationType = "success" | "error" | "info" | "warning";

class AppEventEmitter {
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  // Typed overloads for common events (still implemented generically)
  on(event: "notification:show", callback: (message: string, type: NotificationType, duration?: number) => void): () => void;
  on(event: "notification:history", callback: (history: any[]) => void): () => void;
  on(event: "sale:completed" | "debt:repayment" | "inventory:updated" | "openClosingModal" | "openOpeningModal" | "closing:confirmed" | "closing:completed", callback: (...args: any[]) => void): () => void;
  on(event: string, callback: (...args: any[]) => void): () => void;
  on(event: string, callback: (...args: any[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: (...args: any[]) => void) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) this.listeners.delete(event);
  }

  // Typed emit overloads (fallback preserved)
  emit(event: "notification:show", message: string, type: NotificationType, duration?: number): void;
  emit(event: "notification:history", history: any[]): void;
  emit(event: "sale:completed" | "debt:repayment" | "inventory:updated" | "openClosingModal" | "openOpeningModal" | "closing:confirmed" | "closing:completed", ...args: any[]): void;
  emit(event: string, ...args: any[]): void;
  emit(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((callback) => callback(...args));
  }
}

export const appEvents = new AppEventEmitter();

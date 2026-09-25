// Event emitter for app-wide events
// Keep a minimal typed core with a generic fallback (no `any`)
export type NotificationType = "success" | "error" | "info" | "warning";

// Minimal UI notification shape to type history events (avoid coupling to UI files)
export type UINotification = {
  id: string | number;
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
  // Emitted by every account/debt write (Debts-page entries, repayments,
  // cash-outs, write-offs, credits) and by session checkout, so any listener
  // that shows a client balance (e.g. TopBar's session badge, LIRA-212 Tier
  // A) can refresh live. Replaces "debt:repayment", which had listeners but
  // no emitter anywhere in frontend/src (dead code — see TopBar.tsx).
  "debt:changed": [data?: unknown];
  "inventory:updated": [data?: unknown];
  "closing:open": [];
  "opening:open": [];
  "closing:confirmed": [];
  "closing:completed": [];
  // #28 (LIRA-218) m1 fix — emitted after any telecom recharge submit that
  // can move a carrier line's credits/validity/days_owed (DAYS, CREDIT_
  // TRANSFER, CREDIT_BUYBACK, SHOP_LINE_USE). `carrier` narrows the
  // refresh to one panel; omitted means "refresh regardless" (e.g. a
  // dashboard-wide listener). Listeners: `CarrierLinesPanel` (its own
  // lines + "days still to send" list) and `Recharge/index.tsx`'s own
  // `shopLines` preview state, which otherwise only refetches when
  // `activeProvider` itself changes — a second sale on the SAME provider
  // tab used to read a stale `primaryLine.days_owed`/`validity_expires_at`
  // for its pre-sale warning until the next tab switch.
  "carrier-lines:changed": [carrier?: "alfa" | "mtc"];
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

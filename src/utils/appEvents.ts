// Event emitter for app-wide events
// Event emitter for app-wide events
class AppEventEmitter {
    private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

    on(event: string, callback: (...args: any[]) => void) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);

        // Return unsubscribe function
        return () => {
            this.off(event, callback);
        };
    }

    off(event: string, callback: (...args: any[]) => void) {
        const set = this.listeners.get(event);
        if (!set) return;
        set.delete(callback);
        if (set.size === 0) {
            this.listeners.delete(event);
        }
    }

    emit(event: string, ...args: any[]) {
        this.listeners.get(event)?.forEach(callback => callback(...args));
    }
}

export const appEvents = new AppEventEmitter();

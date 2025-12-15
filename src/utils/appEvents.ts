// Event emitter for app-wide events
class AppEventEmitter {
    private listeners: Map<string, Set<Function>> = new Map();

    on(event: string, callback: Function) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)?.add(callback);

        // Return unsubscribe function
        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }

    emit(event: string, ...args: any[]) {
        this.listeners.get(event)?.forEach(callback => callback(...args));
    }
}

export const appEvents = new AppEventEmitter();

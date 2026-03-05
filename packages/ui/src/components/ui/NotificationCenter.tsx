import React, { useState, useEffect, useRef, useCallback } from "react";
import { appEvents } from "../../utils/appEvents";
import { X, CheckCircle, XCircle, Info, AlertTriangle } from "lucide-react";

export type NotificationItem = {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  duration?: number; // in milliseconds, defaults to 5000
};

const NotificationCenter: React.FC = () => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    const recent = new Map<string, number>();
    const dedupeMs = 5000;
    const handleShowNotification = (
      message: string,
      type: "success" | "error" | "info" | "warning",
      duration?: number,
    ) => {
      const key = `${type}:${message}`;
      const now = Date.now();
      const last = recent.get(key) || 0;
      if (now - last < dedupeMs) return; // suppress duplicate
      recent.set(key, now);
      const id = now.toString();
      const newNotification: NotificationItem =
        duration === undefined
          ? { id, message, type }
          : { id, message, type, duration };
      setNotifications((prev) => [...prev, newNotification]);

      // Record in history
      window.notificationHistory = [
        ...(window.notificationHistory || []),
        newNotification,
      ].slice(-20);
      appEvents.emit("notification:history", window.notificationHistory);

      // Auto-dismiss timer per notification
      const ms = duration ?? (type === "error" ? 3000 : 5000);
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, ms);
      timersRef.current.set(id, timer);
    };

    const unsubscribe = appEvents.on(
      "notification:show",
      handleShowNotification,
    );

    return () => {
      unsubscribe();
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const getIcon = (type: NotificationItem["type"]) => {
    switch (type) {
      case "success":
        return <CheckCircle className="text-emerald-500" size={18} />;
      case "error":
        return <XCircle className="text-red-500" size={16} />;
      case "info":
        return <Info className="text-blue-500" size={18} />;
      case "warning":
        return <AlertTriangle className="text-amber-500" size={18} />;
      default:
        return <Info className="text-gray-500" size={18} />;
    }
  };

  const getBgColorClass = (type: NotificationItem["type"]) => {
    switch (type) {
      case "success":
        return "bg-emerald-900/80 border-emerald-500";
      case "error":
        return "bg-red-900/80 border-red-500";
      case "info":
        return "bg-blue-900/80 border-blue-500";
      case "warning":
        return "bg-amber-900/80 border-amber-500";
      default:
        return "bg-slate-800/80 border-slate-600";
    }
  };

  const MAX_VISIBLE = 5;
  const hiddenCount = Math.max(0, notifications.length - MAX_VISIBLE);
  const visible = notifications.slice(-MAX_VISIBLE);

  return (
    <div className="fixed bottom-4 right-4 z-[1000] space-y-2">
      {hiddenCount > 0 && (
        <div className="flex items-center justify-center px-3 py-1.5 rounded-lg bg-slate-800/90 border border-slate-600 text-slate-300 text-xs backdrop-blur-md">
          +{hiddenCount} more notification{hiddenCount > 1 ? "s" : ""}
        </div>
      )}
      {visible.map((notification) => {
        const isError = notification.type === "error";
        return (
          <div
            key={notification.id}
            className={`flex items-center gap-2 ${isError ? "px-3 py-2" : "p-4"} rounded-lg shadow-lg backdrop-blur-md border ${getBgColorClass(notification.type)} animate-in slide-in-from-right-full fade-in duration-300 ${isError ? "max-w-xs" : ""}`}
            role="alert"
          >
            {getIcon(notification.type)}
            <p
              className={`text-white ${isError ? "text-xs" : "text-sm"} flex-1`}
            >
              {notification.message}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismiss(notification.id);
              }}
              className="text-white/70 hover:text-white transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default NotificationCenter;

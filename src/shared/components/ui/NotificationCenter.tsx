import React, { useState, useEffect } from "react";
import { appEvents } from "../../utils/appEvents";
import { XCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";

interface Notification {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "warning";
  duration?: number; // in milliseconds, defaults to 5000
}

const NotificationCenter: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

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
      const newNotification: Notification = { id, message, type, duration };
      setNotifications((prev) => [...prev, newNotification]);
    };

    const unsubscribe = appEvents.on(
      "notification:show",
      handleShowNotification,
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (notifications.length > 0) {
      (window as any).notificationHistory = [
        ...((window as any).notificationHistory || []),
        notifications[notifications.length - 1],
      ].slice(-20);
      appEvents.emit(
        "notification:history",
        (window as any).notificationHistory,
      );
      const timer = setTimeout(() => {
        setNotifications((prev) => prev.slice(1)); // Remove the oldest notification
      }, notifications[0].duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [notifications]);

  const getIcon = (type: Notification["type"]) => {
    switch (type) {
      case "success":
        return <CheckCircle className="text-emerald-500" />;
      case "error":
        return <XCircle className="text-red-500" />;
      case "info":
        return <Info className="text-blue-500" />;
      case "warning":
        return <AlertTriangle className="text-amber-500" />;
      default:
        return <Info className="text-gray-500" />;
    }
  };

  const getBgColorClass = (type: Notification["type"]) => {
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

  return (
    <div className="fixed bottom-4 right-4 z-[1000] space-y-3">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`flex items-center gap-3 p-4 rounded-lg shadow-lg backdrop-blur-md border ${getBgColorClass(notification.type)} animate-in slide-in-from-right-full fade-in duration-300`}
          role="alert"
        >
          {getIcon(notification.type)}
          <p className="text-white text-sm">{notification.message}</p>
          <button
            onClick={() =>
              setNotifications((prev) =>
                prev.filter((n) => n.id !== notification.id),
              )
            }
            className="text-white/70 hover:text-white transition-colors"
          >
            <XCircle size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default NotificationCenter;

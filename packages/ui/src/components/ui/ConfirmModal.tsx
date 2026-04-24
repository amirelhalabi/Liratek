import React, { useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "warning" | "info";
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "danger",
}) => {
  // Fix Electron/Windows focus bug: nudge window focus when modal closes
  useEffect(() => {
    if (!isOpen) return;
    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;
    return () => {
      try {
        (window as any).api?.display?.fixFocus?.();
      } catch {
        /* ignore */
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const variantClasses = {
    danger: "bg-red-600 hover:bg-red-500 shadow-red-900/20",
    warning: "bg-amber-600 hover:bg-amber-500 shadow-amber-900/20",
    info: "bg-violet-600 hover:bg-violet-500 shadow-violet-900/20",
  };

  const iconClasses = {
    danger: "text-red-400 bg-red-400/10",
    warning: "text-amber-400 bg-amber-400/10",
    info: "text-violet-400 bg-violet-400/10",
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl ${iconClasses[variant]}`}>
              <AlertTriangle size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {message}
              </p>
            </div>
            <button
              onClick={onCancel}
              className="text-slate-500 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex gap-3 p-6 bg-slate-800/50 border-t border-slate-700">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 rounded-lg text-white font-bold transition-all shadow-lg ${variantClasses[variant]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

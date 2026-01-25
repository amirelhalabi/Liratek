/**
 * AlertBanner Component
 * Informational banner for modals
 */

import type { ReactNode } from "react";

interface AlertBannerProps {
  type: "info" | "warning" | "success" | "error";
  children: ReactNode;
}

export function AlertBanner({ type, children }: AlertBannerProps) {
  const styles = {
    info: {
      bg: "bg-blue-500/10",
      border: "border-blue-500/30",
      text: "text-blue-200",
    },
    warning: {
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/30",
      text: "text-yellow-200",
    },
    success: {
      bg: "bg-green-500/10",
      border: "border-green-500/30",
      text: "text-green-200",
    },
    error: {
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      text: "text-red-200",
    },
  };

  const style = styles[type];

  return (
    <div className={`${style.bg} border ${style.border} rounded-xl p-4`}>
      <p className={`${style.text} font-semibold`}>{children}</p>
    </div>
  );
}

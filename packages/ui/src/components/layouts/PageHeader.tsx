import React from "react";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  actions?: React.ReactNode;
}

export default function PageHeader({
  icon: Icon,
  title,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <Icon className="text-violet-500" size={28} />
        <h1 className="text-2xl font-bold text-white">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

import React from "react";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/30">
          <Icon className="w-8 h-8 text-violet-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white">{title}</h1>
          {subtitle && <p className="text-slate-400 mt-1">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

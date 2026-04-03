import {
  DollarSign,
  Clock,
  CreditCard,
  ArrowUpCircle,
  Zap,
  Send,
  Package,
} from "lucide-react";

export interface ServiceTypeOption {
  id: string;
  label: string;
  iconKey: ServiceTypeIcon;
}

export type ServiceTypeIcon =
  | "DollarSign"
  | "Clock"
  | "CreditCard"
  | "ArrowUpCircle"
  | "Zap"
  | "Send"
  | "Package";

const ICON_COMPONENTS: Record<ServiceTypeIcon, typeof DollarSign> = {
  DollarSign: DollarSign,
  Clock: Clock,
  CreditCard: CreditCard,
  ArrowUpCircle: ArrowUpCircle,
  Zap: Zap,
  Send: Send,
  Package: Package,
};

export interface ServiceTypeTabsProps {
  options: ServiceTypeOption[];
  value: string;
  onChange: (value: string) => void;
  accentColor?:
    | "cyan"
    | "red"
    | "orange"
    | "violet"
    | "lime"
    | "amber"
    | "emerald";
  className?: string;
}

export default function ServiceTypeTabs({
  options,
  value,
  onChange,
  accentColor = "cyan",
  className = "",
}: ServiceTypeTabsProps) {
  const accentClasses = {
    cyan: {
      active: "bg-cyan-600 text-white shadow-lg",
      icon: "text-cyan-400",
    },
    red: {
      active: "bg-red-600 text-white shadow-lg",
      icon: "text-red-400",
    },
    orange: {
      active: "bg-orange-600 text-white shadow-lg",
      icon: "text-orange-400",
    },
    violet: {
      active: "bg-violet-600 text-white shadow-lg",
      icon: "text-violet-400",
    },
    lime: {
      active: "bg-lime-600 text-white shadow-lg",
      icon: "text-lime-400",
    },
    amber: {
      active: "bg-amber-600 text-white shadow-lg",
      icon: "text-amber-400",
    },
    emerald: {
      active: "bg-emerald-600 text-white shadow-lg",
      icon: "text-emerald-400",
    },
  };

  const accent = accentClasses[accentColor];

  return (
    <div
      className={`flex gap-2 p-1.5 bg-slate-800 rounded-2xl border border-slate-700/50 h-[60px] ${className}`}
    >
      {options.map((option) => {
        const Icon = ICON_COMPONENTS[option.iconKey];
        const active = value === option.id;

        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={`flex-1 h-full py-3 px-2 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              active
                ? option.id === "TOP_UP"
                  ? "bg-emerald-600 text-white shadow-lg"
                  : accent.active
                : "text-slate-400 hover:text-white hover:bg-slate-700/60"
            }`}
          >
            <Icon size={16} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

import {
  DollarSign,
  Clock,
  CreditCard,
  ArrowUpCircle,
  Zap,
  Send,
  Package,
  FileText,
  ArrowLeftRight,
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
  | "Package"
  | "FileText"
  | "ArrowLeftRight";

const ICON_COMPONENTS: Record<ServiceTypeIcon, typeof DollarSign> = {
  DollarSign: DollarSign,
  Clock: Clock,
  CreditCard: CreditCard,
  ArrowUpCircle: ArrowUpCircle,
  Zap: Zap,
  Send: Send,
  Package: Package,
  FileText: FileText,
  ArrowLeftRight: ArrowLeftRight,
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
  /** Custom hex color (e.g. "#ffde00") for the active tab. Overrides accentColor when provided. */
  customColor?: string | undefined;
  /** Text color for the active tab when using customColor. Defaults to "white". */
  customTextColor?: string | undefined;
  /** Visual scale. "md" (default) is the original 60px bar; "sm" is a slimmer control. */
  size?: "sm" | "md";
  className?: string;
}

export default function ServiceTypeTabs({
  options,
  value,
  onChange,
  accentColor = "cyan",
  customColor,
  customTextColor = "white",
  size = "md",
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

  const container =
    size === "sm"
      ? "p-1 rounded-xl h-11"
      : "p-1.5 rounded-2xl h-[60px]";
  const button =
    size === "sm" ? "py-1.5 px-2 rounded-lg" : "py-3 px-2 rounded-xl";

  return (
    <div
      className={`flex gap-2 bg-slate-800 border border-slate-700/50 ${container} ${className}`}
    >
      {options.map((option) => {
        const Icon = ICON_COMPONENTS[option.iconKey];
        const active = value === option.id;
        // Custom hex color wins over the accent palette, except for the special
        // emerald TOP_UP tab which always keeps its own styling.
        const useCustom = Boolean(customColor) && active && option.id !== "TOP_UP";

        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            className={`flex-1 h-full font-semibold text-sm transition-all flex items-center justify-center gap-2 ${button} ${
              active
                ? option.id === "TOP_UP"
                  ? "bg-emerald-600 text-white shadow-lg"
                  : useCustom
                    ? "shadow-lg"
                    : accent.active
                : "text-slate-400 hover:text-white hover:bg-slate-700/60"
            }`}
            style={
              useCustom
                ? {
                    backgroundColor: customColor,
                    color: customTextColor,
                    boxShadow: `0 10px 15px -3px ${customColor}33`,
                  }
                : undefined
            }
          >
            <Icon size={16} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

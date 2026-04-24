import {
  DollarSign,
  Send,
  Package,
  FileText,
  ArrowLeftRight,
} from "lucide-react";

export interface DoubleTabOption {
  id: string;
  label: string;
  iconKey?: DoubleTabIcon;
}

export type DoubleTabIcon =
  | "DollarSign"
  | "Send"
  | "Package"
  | "FileText"
  | "ArrowLeftRight";

const ICON_COMPONENTS: Record<DoubleTabIcon, typeof DollarSign> = {
  DollarSign: DollarSign,
  Send: Send,
  Package: Package,
  FileText: FileText,
  ArrowLeftRight: ArrowLeftRight,
};

export interface DoubleTabProps {
  leftOption: DoubleTabOption;
  rightOption: DoubleTabOption;
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
  /** Custom hex color (e.g. "#ffde00"). Overrides accentColor when provided. */
  customColor?: string | undefined;
  /** Text color for active state when using customColor. Defaults to "white". */
  customTextColor?: string | undefined;
  className?: string;
}

export default function DoubleTab({
  leftOption,
  rightOption,
  value,
  onChange,
  accentColor = "violet",
  customColor,
  customTextColor = "white",
  className = "",
}: DoubleTabProps) {
  const accentClasses = {
    cyan: {
      active: "bg-cyan-600 text-white shadow-lg shadow-cyan-500/20",
      icon: "text-cyan-400",
    },
    red: {
      active: "bg-red-600 text-white shadow-lg shadow-red-500/20",
      icon: "text-red-400",
    },
    orange: {
      active: "bg-orange-600 text-white shadow-lg shadow-orange-500/20",
      icon: "text-orange-400",
    },
    violet: {
      active: "bg-violet-600 text-white shadow-lg shadow-violet-500/20",
      icon: "text-violet-400",
    },
    lime: {
      active: "bg-lime-600 text-white shadow-lg shadow-lime-500/20",
      icon: "text-lime-400",
    },
    amber: {
      active: "bg-amber-600 text-white shadow-lg shadow-amber-500/20",
      icon: "text-amber-400",
    },
    emerald: {
      active: "bg-emerald-600 text-white shadow-lg shadow-emerald-500/20",
      icon: "text-emerald-400",
    },
  };

  const accent = accentClasses[accentColor];

  const renderButton = (option: DoubleTabOption) => {
    const active = value === option.id;
    const Icon = option.iconKey ? ICON_COMPONENTS[option.iconKey] : null;

    // Custom hex color: use inline style for bg + shadow
    if (customColor) {
      return (
        <button
          onClick={() => onChange(option.id)}
          className={`flex-1 h-full py-3 px-2 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
            active
              ? "shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-700/60"
          }`}
          style={
            active
              ? {
                  backgroundColor: customColor,
                  color: customTextColor,
                  boxShadow: `0 10px 15px -3px ${customColor}33`,
                }
              : undefined
          }
        >
          {Icon && <Icon size={16} />}
          {option.label}
        </button>
      );
    }

    return (
      <button
        onClick={() => onChange(option.id)}
        className={`flex-1 h-full py-3 px-2 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
          active
            ? accent.active
            : "text-slate-400 hover:text-white hover:bg-slate-700/60"
        }`}
      >
        {Icon && <Icon size={16} />}
        {option.label}
      </button>
    );
  };

  return (
    <div
      className={`flex gap-2 p-1.5 bg-slate-800 rounded-2xl border border-slate-700/50 h-[60px] ${className}`}
    >
      {renderButton(leftOption)}
      {renderButton(rightOption)}
    </div>
  );
}

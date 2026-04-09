import { User, Store } from "lucide-react";

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  type?: "text" | "email" | "tel" | "number";
  icon?: "user" | "store" | "none";
  autoFocus?: boolean;
  className?: string;
  compact?: boolean;
  required?: boolean;
  autoComplete?: string;
  disabled?: boolean;
}

export default function TextInput({
  value,
  onChange,
  label,
  placeholder = "",
  error,
  type = "text",
  icon = "none",
  autoFocus = false,
  className = "",
  compact = false,
  required = false,
  autoComplete,
  disabled = false,
}: TextInputProps) {
  const inputCls = compact
    ? "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
    : "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30";
  const labelCls = compact
    ? "sr-only"
    : "block text-sm font-medium text-slate-400 mb-1";
  const errorCls = "text-xs text-red-400 mt-1";

  const renderIcon = () => {
    if (icon === "none") return null;
    if (icon === "user") {
      return <User size={14} className="inline mr-1.5 text-violet-400" />;
    }
    if (icon === "store") {
      return <Store size={14} className="inline mr-1.5 text-violet-400" />;
    }
    return null;
  };

  return (
    <div className={className}>
      {label && (
        <label className={labelCls}>
          {renderIcon()}
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
      />
      {error && <p className={errorCls}>{error}</p>}
    </div>
  );
}

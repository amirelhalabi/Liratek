import { useState } from "react";
import { Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useCapsLock } from "@/hooks/useCapsLock";

export interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  showStrength?: boolean;
  autoFocus?: boolean;
  className?: string;
  compact?: boolean;
}

export default function PasswordInput({
  value,
  onChange,
  label = "Password",
  placeholder = "••••••••",
  error,
  showStrength = false,
  autoFocus = false,
  className = "",
  compact = false,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const { capsLock, capsLockProps } = useCapsLock();

  const inputCls = compact
    ? "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
    : "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30";
  const labelCls = compact
    ? "sr-only"
    : "block text-sm font-medium text-slate-400 mb-1";
  const errorCls = "text-xs text-red-400 mt-1";

  return (
    <div className={className}>
      {label && (
        <label className={labelCls}>
          <Lock size={14} className="inline mr-1.5 text-violet-400" />
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls + " pr-10"}
          placeholder={placeholder}
          autoComplete="new-password"
          autoFocus={autoFocus}
          {...capsLockProps}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <p className={errorCls}>{error}</p>}
      {capsLock && (
        <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
          <AlertCircle size={12} />
          Caps Lock is on
        </p>
      )}
      {showStrength && (
        <div className="bg-slate-900/50 rounded-lg px-4 py-3 text-xs text-slate-500 space-y-1 mt-2">
          <p className={/[A-Z]/.test(value) ? "text-emerald-400" : ""}>
            ✓ Uppercase letter
          </p>
          <p className={/[a-z]/.test(value) ? "text-emerald-400" : ""}>
            ✓ Lowercase letter
          </p>
          <p className={/[0-9]/.test(value) ? "text-emerald-400" : ""}>
            ✓ Number
          </p>
          <p className={value.length >= 8 ? "text-emerald-400" : ""}>
            ✓ At least 8 characters
          </p>
        </div>
      )}
    </div>
  );
}

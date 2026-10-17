import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { PASSWORD_SYMBOL_PATTERN } from "@liratek/core";
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
  /**
   * "current-password" on sign-in forms so browsers autofill and offer to
   * save it; the default "new-password" is for forms that create one.
   */
  autoComplete?: "current-password" | "new-password" | "off";
  /** Field name and id — password managers and <label> association rely on them. */
  name?: string;
  id?: string;
  /** `data-testid` on the <input> itself. */
  testId?: string;
  /** Replaces the default input / label classes (a themed page's own look). */
  inputClassName?: string;
  labelClassName?: string;
  required?: boolean;
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
  autoComplete = "new-password",
  name,
  id,
  testId,
  inputClassName,
  labelClassName,
  required,
}: PasswordInputProps) {
  const { t } = useTranslation("shared");
  const [showPassword, setShowPassword] = useState(false);
  const { capsLock, capsLockProps } = useCapsLock();

  const defaultInputCls = compact
    ? "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
    : "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30";
  const inputCls = inputClassName ?? defaultInputCls;
  const labelCls =
    labelClassName ??
    (compact ? "sr-only" : "block text-sm font-medium text-slate-400 mb-1");
  const errorCls = "text-xs text-red-400 mt-1";

  return (
    <div className={className}>
      {label && (
        <label className={labelCls} htmlFor={id}>
          <Lock size={14} className="inline me-1.5 text-violet-400" />
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls + " pe-10"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          name={name}
          id={id}
          data-testid={testId}
          required={required}
          autoFocus={autoFocus}
          {...capsLockProps}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
          aria-label={showPassword ? t("password.hide") : t("password.show")}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <p className={errorCls}>{error}</p>}
      {capsLock && (
        <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
          <AlertCircle size={12} />
          {t("password.capsLock")}
        </p>
      )}
      {showStrength && (
        <div className="bg-slate-900/50 rounded-lg px-4 py-3 text-xs text-slate-500 space-y-1 mt-2">
          <p className={/[A-Z]/.test(value) ? "text-emerald-400" : ""}>
            {t("password.uppercase")}
          </p>
          <p className={/[a-z]/.test(value) ? "text-emerald-400" : ""}>
            {t("password.lowercase")}
          </p>
          <p className={/[0-9]/.test(value) ? "text-emerald-400" : ""}>
            {t("password.number")}
          </p>
          <p className={value.length >= 8 ? "text-emerald-400" : ""}>
            {t("password.minLength")}
          </p>
          <p
            className={
              PASSWORD_SYMBOL_PATTERN.test(value) ? "text-emerald-400" : ""
            }
          >
            {t("password.symbol")}
          </p>
        </div>
      )}
    </div>
  );
}

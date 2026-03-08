import { useState } from "react";
import { useSetup } from "../context/SetupContext";
import { Store, User, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useCapsLock } from "@/hooks/useCapsLock";

export default function Step1Account() {
  const { payload, updatePayload, setStep } = useSetup();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { capsLock, capsLockProps } = useCapsLock();

  const validate = () => {
    const e: Record<string, string> = {};
    if (!payload.shop_name.trim()) e.shop_name = "Shop name is required";
    if (!payload.admin_username.trim())
      e.admin_username = "Username is required";
    if (payload.admin_password.length < 8)
      e.admin_password = "Password must be at least 8 characters";
    if (!/[A-Z]/.test(payload.admin_password))
      e.admin_password = "Password must contain an uppercase letter";
    if (!/[a-z]/.test(payload.admin_password))
      e.admin_password = "Password must contain a lowercase letter";
    if (!/[0-9]/.test(payload.admin_password))
      e.admin_password = "Password must contain a digit";
    if (payload.admin_password !== confirmPassword)
      e.confirm = "Passwords do not match";
    return e;
  };

  const handleNext = () => {
    const e = validate();
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }
    setStep(2);
  };

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30";
  const labelCls = "block text-sm font-medium text-slate-400 mb-1";
  const errorCls = "text-xs text-red-400 mt-1";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Welcome to LiraTek</h2>
        <p className="text-slate-400 text-sm mt-1">
          Set up your shop and create the admin account.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Shop Name */}
        <div className="col-span-2">
          <label className={labelCls}>
            <Store size={14} className="inline mr-1.5 text-violet-400" />
            Shop Name
          </label>
          <input
            type="text"
            value={payload.shop_name}
            onChange={(e) => updatePayload({ shop_name: e.target.value })}
            className={inputCls}
            autoFocus
          />
          {errors.shop_name && <p className={errorCls}>{errors.shop_name}</p>}
        </div>

        {/* Admin Username */}
        <div>
          <label className={labelCls}>
            <User size={14} className="inline mr-1.5 text-violet-400" />
            Admin Username
          </label>
          <input
            type="text"
            value={payload.admin_username}
            onChange={(e) => updatePayload({ admin_username: e.target.value })}
            className={inputCls}
            autoComplete="username"
          />
          {errors.admin_username && (
            <p className={errorCls}>{errors.admin_username}</p>
          )}
        </div>

        {/* Spacer */}
        <div />

        {/* Password */}
        <div>
          <label className={labelCls}>
            <Lock size={14} className="inline mr-1.5 text-violet-400" />
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={payload.admin_password}
              onChange={(e) =>
                updatePayload({ admin_password: e.target.value })
              }
              className={inputCls + " pr-10"}
              autoComplete="new-password"
              {...capsLockProps}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.admin_password && (
            <p className={errorCls}>{errors.admin_password}</p>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label className={labelCls}>Confirm Password</label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputCls + " pr-10"}
              autoComplete="new-password"
              {...capsLockProps}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.confirm && <p className={errorCls}>{errors.confirm}</p>}
        </div>
      </div>

      {capsLock && (
        <p className="text-xs text-amber-400 flex items-center gap-1">
          <AlertCircle size={12} />
          Caps Lock is on
        </p>
      )}

      {/* Password hints */}
      <div className="bg-slate-900/50 rounded-lg px-4 py-3 text-xs text-slate-500 space-y-1">
        <p
          className={
            /[A-Z]/.test(payload.admin_password) ? "text-emerald-400" : ""
          }
        >
          ✓ Uppercase letter
        </p>
        <p
          className={
            /[a-z]/.test(payload.admin_password) ? "text-emerald-400" : ""
          }
        >
          ✓ Lowercase letter
        </p>
        <p
          className={
            /[0-9]/.test(payload.admin_password) ? "text-emerald-400" : ""
          }
        >
          ✓ Number
        </p>
        <p
          className={
            payload.admin_password.length >= 8 ? "text-emerald-400" : ""
          }
        >
          ✓ At least 8 characters
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleNext}
          className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors text-sm"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

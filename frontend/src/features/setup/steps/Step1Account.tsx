import { useState } from "react";
import { useSetup } from "../context/SetupContext";

import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput } from "@liratek/ui";

export default function Step1Account() {
  const { payload, updatePayload, setStep } = useSetup();
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const labelCls = "block text-sm font-medium text-slate-400 mb-1";

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
        <div>
          <TextInput
            value={payload.shop_name}
            onChange={(value) => updatePayload({ shop_name: value })}
            label="Shop Name"
            placeholder="Enter shop name"
            icon="store"
            error={errors.shop_name}
            autoFocus
          />
        </div>

        {/* Admin Username */}
        <div>
          <TextInput
            value={payload.admin_username}
            onChange={(value) => updatePayload({ admin_username: value })}
            label="Admin Username"
            placeholder=""
            icon="user"
            error={errors.admin_username}
            autoComplete="username"
          />
        </div>
      </div>

      {/* Password fields - full width */}
      <div>
        <PasswordInput
          value={payload.admin_password}
          onChange={(value) => updatePayload({ admin_password: value })}
          label="Password"
          error={errors.admin_password}
          showStrength
          className="mb-4"
        />

        <div>
          <label className={labelCls}>Confirm Password</label>
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            label=""
            error={errors.confirm}
          />
        </div>
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

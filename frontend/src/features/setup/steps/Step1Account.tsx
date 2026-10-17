import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetup } from "../context/SetupContext";

import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput } from "@liratek/ui";
import { validatePasswordComplexity } from "@liratek/core";

export default function Step1Account() {
  const { payload, updatePayload, setStep } = useSetup();
  const { t } = useTranslation("setup");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!payload.shop_name.trim()) e.shop_name = t("account.shopNameRequired");
    if (!payload.admin_username.trim())
      e.admin_username = t("account.usernameRequired");
    const pwResult = validatePasswordComplexity(payload.admin_password);
    if (!pwResult.valid) {
      e.admin_password = pwResult.errors[0];
    }
    if (payload.admin_password !== confirmPassword)
      e.confirm = t("account.passwordsMismatch");
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
        <h2 className="text-xl font-bold text-white">{t("account.title")}</h2>
        <p className="text-slate-400 text-sm mt-1">{t("account.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Shop Name */}
        <div>
          <TextInput
            value={payload.shop_name}
            onChange={(value) => updatePayload({ shop_name: value })}
            label={t("account.shopName")}
            placeholder={t("account.shopNamePlaceholder")}
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
            label={t("account.adminUsername")}
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
          label={t("account.password")}
          error={errors.admin_password}
          showStrength
          className="mb-4"
        />

        <div>
          <label className={labelCls}>{t("account.confirmPassword")}</label>
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
          {t("nav.next")}
        </button>
      </div>
    </div>
  );
}

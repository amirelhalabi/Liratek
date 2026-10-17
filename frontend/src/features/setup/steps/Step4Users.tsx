import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetup } from "../context/SetupContext";
import { Plus, Trash2 } from "lucide-react";
import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput, Select } from "@liratek/ui";
import { validatePasswordComplexity } from "@liratek/core";

export default function Step4Users() {
  const { payload, updatePayload, setStep } = useSetup();
  const { t } = useTranslation("setup");
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    role: "staff",
  });
  const [error, setError] = useState("");

  const addUser = () => {
    if (!newUser.username.trim() || !newUser.password) return;
    const pwResult = validatePasswordComplexity(newUser.password);
    if (!pwResult.valid) {
      setError(pwResult.errors[0]);
      return;
    }
    setError("");
    updatePayload({ extra_users: [...payload.extra_users, { ...newUser }] });
    setNewUser({ username: "", password: "", role: "staff" });
  };

  const removeUser = (idx: number) => {
    updatePayload({
      extra_users: payload.extra_users.filter((_, i) => i !== idx),
    });
  };

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">
            {t("usersStep.title")}
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            {t("usersStep.subtitle")}
          </p>
        </div>
        <button
          onClick={() => setStep(6)}
          className="text-xs text-slate-400 hover:text-white underline mt-1"
        >
          {t("nav.skip")}
        </button>
      </div>

      {/* Extra Users */}
      <div className="bg-slate-900/50 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">
          {t("users.staffUsers")}
        </h3>

        {payload.extra_users.length > 0 && (
          <div className="space-y-2">
            {payload.extra_users.map((u, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2"
              >
                <div>
                  <span className="text-sm text-white font-medium">
                    {u.username}
                  </span>
                  <span className="ms-2 text-xs text-slate-400">
                    {u.role === "admin"
                      ? t("users.roleAdmin")
                      : t("users.roleStaff")}
                  </span>
                </div>
                <button
                  onClick={() => removeUser(i)}
                  className="text-slate-500 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <TextInput
            value={newUser.username}
            onChange={(value) => setNewUser((p) => ({ ...p, username: value }))}
            label=""
            placeholder={t("users.username")}
            compact
          />
          <PasswordInput
            value={newUser.password}
            onChange={(value) => setNewUser((p) => ({ ...p, password: value }))}
            label=""
            placeholder={t("users.password")}
            compact
          />
          <div className="flex gap-2">
            <Select
              value={newUser.role}
              onChange={(v) => setNewUser((p) => ({ ...p, role: v }))}
              options={[
                { value: "staff", label: t("users.roleStaff") },
                { value: "admin", label: t("users.roleAdmin") },
              ]}
              buttonClassName={inputCls}
            />
            <button
              onClick={addUser}
              className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* WhatsApp */}
      <div className="bg-slate-900/50 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">
          {t("usersStep.whatsapp")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t("usersStep.phone")}
            </label>
            <input
              type="text"
              value={payload.whatsapp_phone}
              onChange={(e) =>
                updatePayload({ whatsapp_phone: e.target.value })
              }
              className={inputCls}
              placeholder="+961..."
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {t("usersStep.apiKey")}
            </label>
            <PasswordInput
              value={payload.whatsapp_api_key}
              onChange={(value) => updatePayload({ whatsapp_api_key: value })}
              label=""
              placeholder={t("usersStep.apiKeyPlaceholder")}
              compact
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setStep(4)}
          className="px-6 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors text-sm"
        >
          {t("nav.back")}
        </button>
        <button
          onClick={() => setStep(6)}
          className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {t("nav.next")}
        </button>
      </div>
    </div>
  );
}

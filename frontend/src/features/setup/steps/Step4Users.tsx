import { useState } from "react";
import { useSetup } from "../context/SetupContext";
import { Plus, Trash2 } from "lucide-react";
import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput } from "@liratek/ui";
import { validatePassword } from "@/shared/utils/validatePassword";

export default function Step4Users() {
  const { payload, updatePayload, setStep } = useSetup();
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    role: "staff",
  });
  const [error, setError] = useState("");

  const addUser = () => {
    if (!newUser.username.trim() || !newUser.password) return;
    const pwResult = validatePassword(newUser.password);
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
          <h2 className="text-xl font-bold text-white">Users & WhatsApp</h2>
          <p className="text-slate-400 text-sm mt-1">
            Add staff users and configure WhatsApp. Both are optional — you can
            do this later in Settings.
          </p>
        </div>
        <button
          onClick={() => setStep(5)}
          className="text-xs text-slate-400 hover:text-white underline mt-1"
        >
          Skip
        </button>
      </div>

      {/* Extra Users */}
      <div className="bg-slate-900/50 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Staff Users</h3>

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
                  <span className="ml-2 text-xs text-slate-400 capitalize">
                    {u.role}
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
            placeholder="Username"
            compact
          />
          <PasswordInput
            value={newUser.password}
            onChange={(value) => setNewUser((p) => ({ ...p, password: value }))}
            label=""
            placeholder="Password"
            compact
          />
          <div className="flex gap-2">
            <select
              value={newUser.role}
              onChange={(e) =>
                setNewUser((p) => ({ ...p, role: e.target.value }))
              }
              className={inputCls}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
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
          WhatsApp Integration
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Phone Number
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
            <label className="block text-xs text-slate-400 mb-1">API Key</label>
            <PasswordInput
              value={payload.whatsapp_api_key}
              onChange={(value) => updatePayload({ whatsapp_api_key: value })}
              label=""
              placeholder="Enter API Key"
              compact
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setStep(3)}
          className="px-6 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors text-sm"
        >
          ← Back
        </button>
        <button
          onClick={() => setStep(5)}
          className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg transition-colors text-sm"
        >
          Finish Setup →
        </button>
      </div>
    </div>
  );
}

/**
 * Join Existing Shop step.
 *
 * Shown when the user selected a network DB. Displays the shop name
 * (read-only) and lets them add staff users, then restarts the app.
 */

import { useState } from "react";
import { useSetup } from "../context/SetupContext";
import { Plus, Trash2, Loader2 } from "lucide-react";
import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput } from "@liratek/ui";

export default function StepJoinShop() {
  const { payload, setStep } = useSetup();
  const [users, setUsers] = useState<
    Array<{ username: string; password: string; role: string }>
  >([]);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    role: "staff",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const addUser = () => {
    if (!newUser.username.trim() || !newUser.password) return;
    setUsers((prev) => [...prev, { ...newUser }]);
    setNewUser({ username: "", password: "", role: "staff" });
  };

  const removeUser = (idx: number) => {
    setUsers((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleJoin = async () => {
    if (users.length === 0) {
      setError("Add at least one staff user for this laptop");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await window.api.setup.joinExistingShop({
        dbPath: payload.join_db_path!,
        users,
      });

      if (!result.success) {
        setError(result.error || "Failed to join shop");
        return;
      }

      if (result.requiresRestart) {
        // Show restart message — the app needs to restart to pick up the new DB
        setError("");
        // Use Electron's app.relaunch
        window.api.setup.relaunch();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">
          Join {payload.shop_name}
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Add staff users for this laptop. They&apos;ll be able to log in and
          use the shop&apos;s shared database.
        </p>
      </div>

      {/* Shop info (read-only) */}
      <div className="bg-slate-900/50 rounded-xl p-4">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Shop</span>
          <span className="text-white font-medium">{payload.shop_name}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-slate-400">Database</span>
          <span className="text-xs text-slate-500 truncate max-w-[300px]">
            {payload.join_db_path}
          </span>
        </div>
      </div>

      {/* Staff Users */}
      <div className="bg-slate-900/50 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Staff Users</h3>

        {users.length > 0 && (
          <div className="space-y-2">
            {users.map((u, i) => (
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
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <button
          onClick={() => setStep(0)}
          className="px-6 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors text-sm"
        >
          &larr; Back
        </button>
        <button
          onClick={handleJoin}
          disabled={loading}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors text-sm flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Joining...
            </>
          ) : (
            "Join Shop & Restart"
          )}
        </button>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useSetup } from "../context/SetupContext";
import { useAuth } from "../../auth/context/AuthContext";
import { CheckCircle, Loader2 } from "lucide-react";
import { appEvents } from "@liratek/ui";

export default function StepComplete() {
  const { payload, resetWizard } = useSetup();
  const { login, clearSetupRequired } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLaunch = async () => {
    setLoading(true);
    setError("");
    try {
      // Complete setup via IPC
      const result = window.api
        ? await window.api.setup.complete(payload)
        : { success: false, error: "Setup IPC not available" };

      if (!result.success) {
        setError(result.error ?? "Setup failed");
        return;
      }

      // Auto-login with new admin credentials
      const loginResult = await login(
        payload.admin_username,
        payload.admin_password,
      );
      if (!loginResult.success) {
        setError(loginResult.error ?? "Login after setup failed");
        return;
      }

      // Refresh all module/feature-flag contexts so they pick up the
      // values the user just configured (instead of the seeded defaults)
      window.dispatchEvent(new Event("modules-changed"));
      window.dispatchEvent(new Event("feature-flags-changed"));

      // Clear setup flag so the router navigates away from /setup
      clearSetupRequired();
      resetWizard();
      appEvents.emit(
        "notification:show",
        `Welcome to ${payload.shop_name}! Setup complete.`,
        "success",
        6000,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const enabledModuleCount = payload.enabled_modules.length;

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle size={36} className="text-emerald-400" />
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-white">You're all set!</h2>
        <p className="text-slate-400 text-sm mt-2">
          Your shop is configured and ready to launch.
        </p>
      </div>

      <div className="bg-slate-900/50 rounded-xl p-4 text-left space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Shop Name</span>
          <span className="text-white font-medium">{payload.shop_name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Admin User</span>
          <span className="text-white font-medium">
            {payload.admin_username}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Modules Enabled</span>
          <span className="text-white font-medium">{enabledModuleCount}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Opening & Closing</span>
          <span
            className={
              payload.session_management_enabled
                ? "text-emerald-400"
                : "text-slate-500"
            }
          >
            {payload.session_management_enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Customer Sessions</span>
          <span
            className={
              payload.customer_sessions_enabled
                ? "text-emerald-400"
                : "text-slate-500"
            }
          >
            {payload.customer_sessions_enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        {payload.extra_users.length > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Additional Users</span>
            <span className="text-white font-medium">
              {payload.extra_users.length}
            </span>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      <button
        onClick={handleLaunch}
        disabled={loading}
        className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Setting up…
          </>
        ) : (
          "Launch App →"
        )}
      </button>
    </div>
  );
}

import { useState } from "react";
import { useSetup } from "../context/SetupContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { CheckCircle, Loader2 } from "lucide-react";
import { appEvents } from "@liratek/ui";

export default function StepComplete() {
  const { payload, resetWizard, setStep } = useSetup();
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

      // Auto-login with new admin credentials BEFORE applying the initial
      // drawer amounts: closing:create-checkpoint is an admin-only IPC, so it
      // needs an authenticated session — which login() establishes in the main
      // process. Running the checkpoint first (pre-login) silently fails the
      // requireRole check, leaving the dashboard showing "amounts not set".
      const loginResult = await login(
        payload.admin_username,
        payload.admin_password,
      );
      if (!loginResult.success) {
        setError(loginResult.error ?? "Login after setup failed");
        return;
      }

      // Register any currencies the operator added to a drawer at the drawer-
      // amounts step (e.g. EUR) BEFORE the checkpoint, so the currency is
      // first-class (shows on the dashboard + is offered in future checkpoints).
      // Admin-only IPC — safe here because login() ran just above.
      if (window.api && payload.drawer_currency_config?.length) {
        for (const cfg of payload.drawer_currency_config) {
          await window.api.currencies.setDrawerCurrencies(
            cfg.drawer_name,
            cfg.currency_codes,
          );
        }
      }

      // Record the initial setup checkpoint (A4): ALWAYS written, so the
      // checkpoint timeline starts with a baseline row — even when the
      // operator skipped the drawer amounts (all drawers start at zero).
      // user_id must be the admin's real id: the seed admin (id=1) is deleted
      // when a custom username is chosen, so a hardcoded 1 would violate the
      // daily_closings.created_by FK and roll the checkpoint back.
      if (window.api) {
        await window.api.closing.createCheckpoint({
          user_id: result.adminUserId ?? 1,
          drawer_name: "AGGREGATED",
          notes: "Initial drawer amounts from setup",
          amounts: (payload.drawer_amounts ?? []).map((d) => ({
            drawer_name: d.drawer_name,
            currency_code: d.currency_code,
            expected_amount: d.amount,
            physical_amount: d.amount,
          })),
        });
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

  // "MTC + Alfa set" / "MTC only" / "Alfa only" / "Skipped" (Phase 2 spec).
  // Reads the SAME payload.carrier_lines array setupHandlers.ts persists —
  // no separate "was it filled in" state to drift from what was actually sent.
  const carrierLines = payload.carrier_lines ?? [];
  const hasMtcLine = carrierLines.some((l) => l.carrier === "mtc");
  const hasAlfaLine = carrierLines.some((l) => l.carrier === "alfa");
  const carrierLinesSummary =
    hasMtcLine && hasAlfaLine
      ? "MTC + Alfa set"
      : hasMtcLine
        ? "MTC only"
        : hasAlfaLine
          ? "Alfa only"
          : "Skipped";

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
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Starting Drawer Amounts</span>
          <span
            className={
              payload.drawer_amounts && payload.drawer_amounts.length > 0
                ? "text-emerald-400"
                : "text-slate-500"
            }
          >
            {payload.drawer_amounts && payload.drawer_amounts.length > 0
              ? `${payload.drawer_amounts.length} set`
              : "Skipped"}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Carrier Lines</span>
          <span
            className={
              carrierLinesSummary === "Skipped"
                ? "text-slate-500"
                : "text-emerald-400"
            }
          >
            {carrierLinesSummary}
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => setStep(6)}
          disabled={loading}
          className="px-4 py-3 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50"
        >
          ← Back
        </button>
        <button
          onClick={handleLaunch}
          disabled={loading}
          className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
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
    </div>
  );
}

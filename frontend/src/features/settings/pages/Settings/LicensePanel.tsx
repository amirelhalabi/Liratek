/**
 * Licence panel — where a shop enters the key its supplier issued.
 *
 * DESKTOP ONLY. Primary defense: the "license" tab is filtered out of the
 * Settings tab list entirely on the web build (`DESKTOP_ONLY_TABS` in
 * `Settings/index.tsx`), and its `?tab=license` deep link falls back to Shop
 * Config — a web visitor never reaches this component. `hasLicenseChannel()`
 * below is a second line of defense in case that ever changes: instead of
 * throwing on `window.api.license.*`, it renders a one-line explanation.
 * (That fallback line used to be this tab's ENTIRE content on the web —
 * shipping a tab whose only content was "no licence key to enter here" was
 * reported as a bug, worse than no tab at all, which is why the tab-list
 * filter is now the actual fix and this stays a fallback, not the mechanism.)
 *
 * On the web a tenant's plan is managed entirely by the platform owner and
 * there is no key to type: identity arrives in the JWT.
 *
 * The panel's real job is diagnosis. Enforcement fails open by design, so
 * "nothing is restricted" is indistinguishable from "the licence check is
 * broken" unless something says which — hence the plain-language status line
 * and a Check now button, which is what a support call needs.
 */

import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { isElectron } from "@/api/backendApi";
import logger from "@/utils/logger";

interface LicenseState {
  hasLicenseKey: boolean;
  licenseKeyMasked: string | null;
  subscription: {
    status: string;
    plan: string;
    canWrite: boolean;
    currentPeriodEnd: string | null;
    graceEndsAt: string | null;
    entitledModules: string[] | null;
  } | null;
}

/**
 * Is the desktop licence channel actually there?
 *
 * `isElectron()` alone is not enough: it is `!!window.api`, and the web e2e
 * shim installs a `window.api` that carries only the namespaces it maps. So a
 * check on isElectron() would pass under the shim and then throw on
 * `window.api.license.status`. Asking for the namespace itself is the honest
 * question -- this panel needs the CHANNEL, not the runtime.
 */
function hasLicenseChannel(): boolean {
  return isElectron() && typeof window.api?.license?.status === "function";
}
export default function LicensePanel() {
  const [state, setState] = useState<LicenseState | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasLicenseChannel()) return;
    try {
      const res = await window.api.license.status();
      if (res.success && res.data) {
        setState({
          hasLicenseKey: res.data.hasLicenseKey,
          licenseKeyMasked: res.data.licenseKeyMasked,
          subscription: res.data.subscription,
        });
      } else {
        setError(res.error ?? "Could not read the licence");
      }
    } catch (err) {
      logger.error("license status failed:", err);
      setError("Could not read the licence");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!hasLicenseChannel()) {
    return (
      <div className="text-sm text-slate-400">
        Your plan is managed by LiraTek and applies automatically to this
        account — there is no licence key to enter here.
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await window.api.license.setKey({
        licenseKey: keyInput.trim() || null,
      });
      if (res.success) {
        setMessage(res.data?.detail ?? "Saved");
        setKeyInput("");
        await load();
      } else {
        setError(res.error ?? "Could not save the key");
      }
    } catch (err) {
      logger.error("license setKey failed:", err);
      setError("Could not save the key");
    } finally {
      setBusy(false);
    }
  };

  const checkNow = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await window.api.license.check();
      if (res.success) {
        setMessage(res.data?.detail ?? "Checked");
        await load();
      } else {
        setError(res.error ?? "Check failed");
      }
    } catch (err) {
      logger.error("license check failed:", err);
      setError("Check failed");
    } finally {
      setBusy(false);
    }
  };

  const sub = state?.subscription;
  const modules = sub?.entitledModules;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-violet-400" />
          Licence
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Enter the key LiraTek gave you. Everything keeps working without one —
          a key is what lets your plan be managed remotely.
        </p>
      </div>

      {/* Current state */}
      <div className="bg-slate-900 rounded-lg border border-slate-700 p-4 space-y-2">
        <Row
          label="Licence key"
          value={
            state?.hasLicenseKey
              ? (state.licenseKeyMasked ?? "Set")
              : "Not set — no restrictions"
          }
        />
        <Row label="Plan" value={sub?.plan ?? "—"} />
        <Row
          label="Status"
          value={
            sub
              ? sub.status === "active"
                ? "Active"
                : sub.status === "grace"
                  ? `Payment overdue — full access until ${fmt(sub.graceEndsAt)}`
                  : "Read-only — viewing and exporting still work"
              : "—"
          }
        />
        <Row
          label="Renews / ends"
          value={
            sub?.currentPeriodEnd ? fmt(sub.currentPeriodEnd) : "No expiry"
          }
        />
        <Row
          label="Modules"
          value={
            modules === null || modules === undefined
              ? "All modules"
              : modules.length === 0
                ? "None beyond the basics"
                : modules.join(", ")
          }
        />
      </div>

      {/* Enter / replace the key */}
      <div className="space-y-2">
        <label className="text-xs text-slate-400 block" htmlFor="license-key">
          {state?.hasLicenseKey ? "Replace the key" : "Licence key"}
        </label>
        <div className="flex gap-2">
          <input
            id="license-key"
            data-testid="license-key-input"
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="lsk_..."
            autoComplete="off"
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          />
          <button
            onClick={save}
            disabled={busy}
            data-testid="license-save"
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Save
          </button>
          <button
            onClick={checkNow}
            disabled={busy}
            data-testid="license-check"
            title="Ask the server for the latest plan"
            className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:text-slate-500 text-white text-sm rounded-lg transition-colors flex items-center gap-1"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
            Check now
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Leave the box empty and press Save to remove the key. Removing it
          restores full access — it never locks anything.
        </p>
      </div>

      {message && (
        <div
          role="status"
          className="flex items-start gap-2 text-sm text-green-400"
        >
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 text-sm text-red-400"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-white text-right break-words">{value}</span>
    </div>
  );
}

/** Dates arrive as `YYYY-MM-DD HH:MM:SS`; only the day is meaningful here. */
function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

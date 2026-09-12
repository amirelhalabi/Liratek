/**
 * Signed-in Devices
 *
 * Settings tab for SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2 step 5 —
 * lets the current user see every active session on their own account and
 * end one they no longer control (a laptop left at home, a shared
 * terminal), without touching anyone else's sessions (owner decision: own
 * sessions only, no admin-manages-other-users in v1).
 *
 * Data access goes through useApi() only — never a raw `window.api.*` call
 * and never an `if (window.api)` transport gate, so this works identically
 * on desktop (IPC) and in the browser (REST), including under the web-test
 * shim (rule 19 / CLAUDE.md).
 */

import { useCallback, useEffect, useState } from "react";
import { appEvents, useApi, DataTable } from "@liratek/ui";
// SafeSession comes straight from @liratek/core, not the @liratek/ui barrel:
// packages/ui/src/api/index.ts re-exports types from ./types via a curated
// named list (not `export *`), and SafeSession isn't on it yet even though
// api/types.ts itself exports it — so `import { type SafeSession } from
// "@liratek/ui"` would fail to resolve. Importing it from core directly
// (the pattern several other frontend files already use for @liratek/core
// types) sidesteps that gap without touching a file outside this task's
// ownership.
import type { SafeSession } from "@liratek/core";
import { useAuth } from "@/features/auth/context/AuthContext";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { messageFrom } from "@/api/apiError";

/** `device_type` values are internal ("electron" | "web" | "mobile" |
 * "unknown" | "impersonation") — map them to the label an operator reads. */
const DEVICE_TYPE_LABELS: Record<string, string> = {
  electron: "Desktop app",
  web: "Web browser",
  mobile: "Mobile",
  impersonation: "Impersonated session",
  unknown: "Unknown device",
};

function deviceLabel(session: SafeSession): string {
  return DEVICE_TYPE_LABELS[session.device_type] ?? session.device_type;
}

export default function SignedInDevices() {
  const api = useApi();
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<SafeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-row busy id, plus a separate flag for "Sign out everywhere else" —
  // both disable their own control only, so revoking one row doesn't freeze
  // the rest of the list.
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listUserSessions();
      setSessions(rows);
    } catch (e) {
      setError(messageFrom(e, "Failed to load signed-in devices"));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = async (session: SafeSession) => {
    if (!confirm("End this session? That device will be signed out.")) return;
    setRevokingId(session.id);
    try {
      const res = await api.revokeSession(session.id);
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || "Failed to end session",
          "error",
        );
        return;
      }
      appEvents.emit("notification:show", "Session ended", "success");
      await load();
    } catch (e) {
      appEvents.emit(
        "notification:show",
        messageFrom(e, "Failed to end session"),
        "error",
      );
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOthers = async () => {
    if (
      !confirm(
        "Sign out every other device? This device stays signed in; every other session for your account ends.",
      )
    )
      return;
    setRevokingOthers(true);
    try {
      const res = await api.revokeOtherSessions();
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || "Failed to sign out other devices",
          "error",
        );
        return;
      }
      const count = res.data?.revoked ?? 0;
      appEvents.emit(
        "notification:show",
        count > 0
          ? `Signed out ${count} other device(s)`
          : "No other devices were signed in",
        "success",
      );
      await load();
    } catch (e) {
      appEvents.emit(
        "notification:show",
        messageFrom(e, "Failed to sign out other devices"),
        "error",
      );
    } finally {
      setRevokingOthers(false);
    }
  };

  const otherSessionsCount = sessions.filter((s) => !s.is_current).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-400 text-sm">
          Every device currently signed in to your account. End a session on a
          device you no longer control — the current device shows a{" "}
          <span className="text-slate-300">This device</span> badge and can only
          sign itself out normally.
        </p>
        <button
          onClick={handleRevokeOthers}
          disabled={revokingOthers || otherSessionsCount === 0}
          className="shrink-0 px-3 py-1.5 rounded bg-red-600/80 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-600/80 text-white text-sm transition-colors"
        >
          {revokingOthers ? "Signing out…" : "Sign out everywhere else"}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <DataTable
          columns={[
            "Device",
            "IP Address",
            "Last Activity",
            { header: "Actions", className: "p-2 text-right" },
          ]}
          data={sessions}
          loading={loading}
          emptyMessage="No signed-in devices"
          renderRow={(s) => (
            <tr key={s.id} className="border-t border-slate-800">
              <td className="p-2">
                <div className="flex items-center gap-2">
                  <span className="text-white">{deviceLabel(s)}</span>
                  {s.is_current && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-600/20 text-violet-400">
                      This device
                    </span>
                  )}
                </div>
                {s.device_info && (
                  <div className="text-xs text-slate-500 truncate max-w-md">
                    {s.device_info}
                  </div>
                )}
              </td>
              <td className="p-2 text-slate-300 font-mono text-xs">
                {s.ip_address || "—"}
              </td>
              <td className="p-2 text-slate-300">
                {parseDbDate(s.last_activity_at).toLocaleString()}
              </td>
              <td className="p-2 text-right">
                {s.is_current ? (
                  <button
                    onClick={() => logout()}
                    className="text-xs px-2 py-1 bg-slate-700 rounded text-white"
                  >
                    Sign out
                  </button>
                ) : (
                  <button
                    onClick={() => handleRevoke(s)}
                    disabled={revokingId === s.id}
                    className="text-xs px-2 py-1 bg-red-600/80 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-600/80 rounded text-white transition-colors"
                  >
                    {revokingId === s.id ? "Ending…" : "Revoke"}
                  </button>
                )}
              </td>
            </tr>
          )}
        />
      </div>
    </div>
  );
}

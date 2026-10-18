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
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { useFormat } from "@/i18n/useFormat";
import {
  activityAge,
  deviceName,
  groupSessionsByUser,
  isStale,
} from "./devicesFormat";

/** `device_type` values are internal ("electron" | "web" | "mobile" |
 * "unknown" | "impersonation") — map them to the label an operator reads. */
const DEVICE_TYPE_KEYS = {
  electron: "devices.type.electron",
  web: "devices.type.web",
  mobile: "devices.type.mobile",
  impersonation: "devices.type.impersonation",
  unknown: "devices.type.unknown",
} as const;

/** Full timestamp, the same text `Date#toLocaleString()` gave in English. */
const DATE_TIME = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
} as const;

export default function SignedInDevices() {
  const { t } = useTranslation("settings");
  const { formatDateTime } = useFormat();
  const deviceLabel = (session: SafeSession): string =>
    session.device_type in DEVICE_TYPE_KEYS
      ? t(
          DEVICE_TYPE_KEYS[
            session.device_type as keyof typeof DEVICE_TYPE_KEYS
          ],
        )
      : session.device_type;
  const api = useApi();
  const { logout, user } = useAuth();
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
      setError(messageFrom(e, t("devices.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRevoke = async (session: SafeSession) => {
    if (!confirm(t("devices.revokeConfirm"))) return;
    setRevokingId(session.id);
    try {
      const res = await api.revokeSession(session.id);
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || t("devices.revokeFailed"),
          "error",
        );
        return;
      }
      appEvents.emit("notification:show", t("devices.revoked"), "success");
      await load();
    } catch (e) {
      appEvents.emit(
        "notification:show",
        messageFrom(e, t("devices.revokeFailed")),
        "error",
      );
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOthers = async () => {
    if (!confirm(t("devices.revokeOthersConfirm"))) return;
    setRevokingOthers(true);
    try {
      const res = await api.revokeOtherSessions();
      if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error || t("devices.revokeOthersFailed"),
          "error",
        );
        return;
      }
      const count = res.data?.revoked ?? 0;
      appEvents.emit(
        "notification:show",
        count > 0
          ? t("devices.revokedOthers", { n: count })
          : t("devices.noOthers"),
        "success",
      );
      await load();
    } catch (e) {
      appEvents.emit(
        "notification:show",
        messageFrom(e, t("devices.revokeOthersFailed")),
        "error",
      );
    } finally {
      setRevokingOthers(false);
    }
  };

  // The viewer is whoever owns the "this device" row; on desktop that flag
  // can be missing (no resolvable token), so fall back to the signed-in user.
  const viewerId =
    sessions.find((s) => s.is_current)?.user_id ?? user?.id ?? null;
  // "Sign out everywhere else" only ends the viewer's OWN other sessions, so
  // an admin's count must not include other users' rows.
  const otherSessionsCount = sessions.filter(
    (s) => !s.is_current && s.user_id === viewerId,
  ).length;
  const groups = groupSessionsByUser(sessions, viewerId);
  // Only the admin view ever lists more than one user; staff see no headers.
  const showGroupHeaders = groups.some((g) => g.userId !== viewerId);
  const now = Date.now();

  const lastActivityText = (lastActivityAt: string): string => {
    const age = activityAge(lastActivityAt, now);
    return age.unit === "now"
      ? t("devices.age.now")
      : t(`devices.age.${age.unit}`, { n: age.n });
  };

  const rows = groups.flatMap((g) =>
    showGroupHeaders
      ? [
          { kind: "group" as const, group: g },
          ...g.sessions.map((s) => ({ kind: "session" as const, session: s })),
        ]
      : g.sessions.map((s) => ({ kind: "session" as const, session: s })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-slate-400 text-sm">{t("devices.intro")}</p>
        <button
          onClick={handleRevokeOthers}
          disabled={revokingOthers || otherSessionsCount === 0}
          className="shrink-0 px-3 py-1.5 rounded bg-red-600/80 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-600/80 text-white text-sm transition-colors"
        >
          {revokingOthers
            ? t("devices.signingOut")
            : t("devices.signOutOthers")}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <DataTable
          // <th> centres by default while the cells start-align; match them.
          thClassName="p-2 text-start"
          columns={[
            t("devices.col.device"),
            t("devices.col.ip"),
            t("devices.col.lastActivity"),
            t("devices.col.signOut"),
            { header: t("devices.col.actions"), className: "p-2 text-end" },
          ]}
          data={rows}
          loading={loading}
          emptyMessage={t("devices.empty")}
          renderRow={(row) => {
            if (row.kind === "group") {
              const g = row.group;
              return (
                <tr
                  key={`user-${g.userId}`}
                  className="border-t border-slate-700 bg-slate-800/60"
                >
                  <td colSpan={5} className="p-2 text-sm">
                    <span className="text-white font-medium">
                      {g.username ?? t("devices.unknownUser")}
                    </span>
                    {g.role && (
                      <span className="text-slate-400">
                        {" · "}
                        {t(`devices.role.${g.role}`, { defaultValue: g.role })}
                      </span>
                    )}
                    <span className="text-slate-500">
                      {" · "}
                      {t("devices.deviceCount", { count: g.sessions.length })}
                    </span>
                  </td>
                </tr>
              );
            }
            const s = row.session;
            const stale = !s.is_current && isStale(s.last_activity_at, now);
            const friendlyName = deviceName(s.device_info);
            return (
              <tr
                key={s.id}
                className={`border-t border-slate-800 ${stale ? "opacity-50" : ""}`}
              >
                <td className="p-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-white"
                      title={s.device_info ?? undefined}
                    >
                      {friendlyName ?? deviceLabel(s)}
                    </span>
                    {s.is_current && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-600/20 text-violet-400">
                        {t("devices.thisDevice")}
                      </span>
                    )}
                    {stale && (
                      <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">
                        {t("devices.stale")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate max-w-md">
                    {friendlyName ? deviceLabel(s) : s.device_info}
                  </div>
                </td>
                <td className="p-2 text-slate-300 font-mono text-xs">
                  <Ltr>{s.ip_address || "—"}</Ltr>
                </td>
                <td
                  className="p-2 text-slate-300"
                  title={formatDateTime(
                    parseDbDate(s.last_activity_at),
                    DATE_TIME,
                  )}
                >
                  {s.is_current
                    ? t("devices.age.now")
                    : lastActivityText(s.last_activity_at)}
                </td>
                <td className="p-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      s.remember_me
                        ? "bg-emerald-600/20 text-emerald-400"
                        : "bg-slate-700 text-slate-300"
                    }`}
                    title={t("devices.expiresAt", {
                      at: formatDateTime(parseDbDate(s.expires_at), DATE_TIME),
                    })}
                  >
                    {s.remember_me
                      ? t("devices.remembered")
                      : t("devices.idleTimeout")}
                  </span>
                </td>
                <td className="p-2 text-end">
                  {s.is_current ? (
                    <button
                      onClick={() => logout()}
                      className="text-xs px-2 py-1 bg-slate-700 rounded text-white"
                    >
                      {t("devices.signOut")}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRevoke(s)}
                      disabled={revokingId === s.id}
                      className="text-xs px-2 py-1 bg-red-600/80 hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-600/80 rounded text-white transition-colors"
                    >
                      {revokingId === s.id
                        ? t("devices.ending")
                        : t("devices.revoke")}
                    </button>
                  )}
                </td>
              </tr>
            );
          }}
        />
      </div>
    </div>
  );
}

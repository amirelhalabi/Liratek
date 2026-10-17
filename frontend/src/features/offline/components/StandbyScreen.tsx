/**
 * LIRA-306 — the paired PC's standby screen (plan diagram B, FR-004–FR-008).
 *
 * While the internet works a paired PC does NOT show the web app inside the
 * desktop window (O-new-16: with the desktop bridge present, every call
 * would go to the PC's local copy). It shows this screen instead, with
 * "Open the web app" (system browser) and, after 30 s without the server
 * and with a ready copy, "Work offline".
 *
 * Desktop-only by nature (E1); reached through `useApi()` like every other
 * call — the web adapter answers "Available on the desktop app".
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useApi } from "@liratek/ui";
import type { OfflineStatusView } from "@liratek/core";

export interface StandbyScreenProps {
  status: OfflineStatusView;
  /** ask the parent to re-read the status after an action */
  onChanged: () => void;
}

function copyAgeText(
  seconds: number | null | undefined,
  t: TFunction<"offline">,
): string {
  if (seconds === null || seconds === undefined) return t("standby.age.none");
  if (seconds < 60) return t("standby.age.underMinute");
  const min = Math.floor(seconds / 60);
  if (min < 60) return t("standby.age.minutes", { count: min });
  const h = Math.floor(min / 60);
  if (h < 48) return t("standby.age.hours", { count: h });
  return t("standby.age.days", { count: Math.floor(h / 24) });
}

function money(amount: number | null): string {
  return amount === null ? "" : ` — $${amount.toFixed(2)}`;
}

export function StandbyScreen({ status, onChanged }: StandbyScreenProps) {
  const api = useApi();
  const { t } = useTranslation("offline");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(
    action: () => Promise<{ success: boolean; error?: string }>,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await action();
      if (!r.success) setMessage(r.error ?? t("common.failed"));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const reachable = status.serverReachable === true;
  const held = status.heldItems ?? [];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-xl space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <div>
          <h1 className="text-2xl font-semibold">
            {status.shopName ?? "LiraTek"}
          </h1>
          <p className="text-sm text-slate-400">
            {t("standby.intro", { deviceNo: status.deviceNo ?? "?" })}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-slate-400">{t("standby.server")}</dt>
          <dd className={reachable ? "text-emerald-400" : "text-amber-400"}>
            {reachable
              ? t("standby.connected")
              : t("standby.noInternet", {
                  seconds: status.unreachableSeconds ?? 0,
                })}
          </dd>
          <dt className="text-slate-400">{t("standby.copy")}</dt>
          <dd>
            {copyAgeText(status.copyAgeSeconds, t)}
            {status.copyAgeWarning ? t("standby.copyOld") : ""}
          </dd>
          <dt className="text-slate-400">{t("standby.offlineMode")}</dt>
          <dd>
            {status.ready
              ? t("standby.ready")
              : (status.notReadyReason ?? t("standby.notReady"))}
          </dd>
        </dl>

        {status.lastError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300"
          >
            {status.lastError}
          </p>
        ) : null}

        {held.length > 0 ? (
          <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm">
            <p className="font-medium text-amber-300">
              {t("standby.held", { count: held.length })}
            </p>
            <ul className="mt-2 list-disc ps-5 text-amber-200">
              {held.map((h) => (
                <li key={h.eventId}>
                  {h.label}
                  {money(h.amount)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 font-medium hover:bg-violet-500 disabled:opacity-50"
            disabled={busy}
            onClick={() => run(() => api.openWebApp())}
          >
            {t("standby.openWeb")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-amber-600 px-4 py-2 font-medium hover:bg-amber-500 disabled:opacity-40"
            disabled={busy || status.canGoOffline !== true}
            title={
              status.canGoOffline
                ? undefined
                : t("standby.workOfflineHint")
            }
            onClick={() => run(() => api.goOffline())}
          >
            {t("standby.workOffline")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => run(() => api.installOfflineUpdate())}
          >
            {t("standby.installUpdate")}
          </button>
        </div>

        {message ? (
          <p role="status" className="text-sm text-amber-300">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default StandbyScreen;

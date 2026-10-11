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
import { useApi } from "@liratek/ui";
import type { OfflineStatusView } from "@liratek/core";

export interface StandbyScreenProps {
  status: OfflineStatusView;
  /** ask the parent to re-read the status after an action */
  onChanged: () => void;
}

function copyAgeText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "no copy yet";
  if (seconds < 60) return "less than a minute old";
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min old`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h old`;
  return `${Math.floor(h / 24)} days old`;
}

function money(amount: number | null): string {
  return amount === null ? "" : ` — $${amount.toFixed(2)}`;
}

export function StandbyScreen({ status, onChanged }: StandbyScreenProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(
    action: () => Promise<{ success: boolean; error?: string }>,
  ) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await action();
      if (!r.success) setMessage(r.error ?? "That did not work");
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
            This is PC {status.deviceNo ?? "?"} of the shop. Work in the web app
            while the internet works.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-slate-400">Server</dt>
          <dd className={reachable ? "text-emerald-400" : "text-amber-400"}>
            {reachable
              ? "Connected"
              : `No internet for ${status.unreachableSeconds ?? 0} s`}
          </dd>
          <dt className="text-slate-400">Copy of the shop</dt>
          <dd>
            {copyAgeText(status.copyAgeSeconds)}
            {status.copyAgeWarning
              ? " (older than a day — check the totals after)"
              : ""}
          </dd>
          <dt className="text-slate-400">Offline mode</dt>
          <dd>
            {status.ready ? "Ready" : (status.notReadyReason ?? "Not ready")}
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
              {held.length} offline item(s) from this PC are held for review on
              the web app. Do not collect them again:
            </p>
            <ul className="mt-2 list-disc pl-5 text-amber-200">
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
            Open the web app
          </button>
          <button
            type="button"
            className="rounded-lg bg-amber-600 px-4 py-2 font-medium hover:bg-amber-500 disabled:opacity-40"
            disabled={busy || status.canGoOffline !== true}
            title={
              status.canGoOffline
                ? undefined
                : "Available after 30 seconds without the internet, with a ready copy"
            }
            onClick={() => run(() => api.goOffline())}
          >
            Work offline
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => run(() => api.installOfflineUpdate())}
          >
            Install update
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

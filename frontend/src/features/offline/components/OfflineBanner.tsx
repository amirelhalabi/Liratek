/**
 * LIRA-306 — the strip a PC shows above the app while it works offline
 * (plan diagram B; O-new-17: offline work stays allowed after the internet
 * returns, the banner asks to go back). Desktop-only by nature (E1); calls
 * go through `useApi()`.
 */
import { useState } from "react";
import { useApi } from "@liratek/ui";
import type { OfflineStatusView } from "@liratek/core";

export interface OfflineBannerProps {
  status: OfflineStatusView;
  onChanged: () => void;
}

export function OfflineBanner({ status, onChanged }: OfflineBannerProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const waiting = status.pendingCount ?? 0;
  const back = status.serverReachable === true;

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

  if (status.mode === "finishing") {
    return (
      <div role="status" className="bg-sky-900 px-4 py-2 text-sm text-sky-100">
        Sending the offline work to the server ({waiting} left) — new actions
        wait until this PC is back on the web app.
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 bg-amber-900 px-4 py-2 text-sm text-amber-50"
    >
      <span className="font-semibold">
        {back ? "Internet is back." : "Working offline."} {waiting} actions
        waiting to send.
      </span>
      <span className="text-amber-200">
        Settings, users, supplier settlement and catalog changes are not
        available offline.
      </span>
      {back ? (
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded border border-amber-300 px-3 py-1 hover:bg-amber-800 disabled:opacity-50"
            onClick={() => run(() => api.sendOfflineNow())}
          >
            Send now
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded bg-amber-400 px-3 py-1 font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-50"
            onClick={() => run(() => api.backToWeb())}
          >
            Back to the web app
          </button>
        </span>
      ) : null}
      {message ? (
        <span className="w-full text-amber-200">{message}</span>
      ) : null}
    </div>
  );
}

export default OfflineBanner;

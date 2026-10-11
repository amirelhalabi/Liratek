/**
 * LIRA-306 — Settings › Paired PCs (web app, admins; FR-002).
 *
 * Every desktop PC paired to the shop for offline work: name, PC number, last
 * seen, what it is doing, how much work it still has to send, app version —
 * and Unpair (the PC's key stops working; work it already sent is still
 * booked). Web-only (E1): the desktop branch of the adapter answers
 * "Available on the web app". `api` is read through a ref (rule 25).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import type { PairedDeviceView } from "@liratek/core";
import logger from "@/utils/logger";

const STATE_LABEL: Record<string, string> = {
  standby: "Ready (online)",
  blocked: "Not ready",
  offline: "Working offline",
  finishing: "Sending its work",
};

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function PairedPcsPanel() {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [devices, setDevices] = useState<PairedDeviceView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: number; action: "unpair" | "renumber" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiRef.current.getPairedPcs();
      if (r.success && r.data) setDevices(r.data.devices);
      else setError(r.error ?? "Could not load the paired PCs");
    } catch (err) {
      logger.error("Failed to load paired PCs:", err);
      setError("Could not load the paired PCs");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: number, action: "unpair" | "renumber") => {
    setBusy(true);
    try {
      const r = action === "unpair" ? await apiRef.current.revokePairedPc(id) : await apiRef.current.renumberPairedPc(id);
      await load();
      setError(r.success ? null : (r.error ?? (action === "unpair" ? "Could not unpair the PC" : "Could not ask the PC to renumber")));
    } catch (err) {
      logger.error("Paired PC action failed:", err);
      setError("The action failed");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const confirming = devices.find((d) => d.id === confirm?.id);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Paired PCs</h2>
        <p className="text-sm text-slate-400">
          Desktop PCs that keep a copy of the shop and can keep working when the internet is down.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {confirming && confirm && (
        <div role="dialog" aria-label="Confirm" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-200">
            {confirm.action === "unpair"
              ? `Unpair ${confirming.name}? It will need to be paired again by an admin. Work it already sent is still booked.`
              : `Renumber the unsent work of ${confirming.name}? The next time it connects, it gives its waiting items new numbers after the last one the server has, and sends them again. Nothing is booked twice.`}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(confirming.id, confirm.action)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm"
            >
              Confirm
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-900">
            <tr>
              {["PC", "Name", "Last seen", "State", "Waiting", "Version", ""].map((h) => (
                <th key={h} className="text-left text-xs text-slate-400 px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {devices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-sm text-slate-400">
                  No PC is paired yet.
                </td>
              </tr>
            )}
            {devices.map((d) => (
              <tr key={d.id} className="hover:bg-slate-700/50">
                <td className="px-4 py-3 text-sm text-white">PC {d.deviceNo}</td>
                <td className="px-4 py-3 text-sm text-white">{d.name}</td>
                <td className="px-4 py-3 text-sm text-slate-300">{when(d.lastSeenAt)}</td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {d.revokedAt ? "Unpaired" : (STATE_LABEL[d.state ?? ""] ?? "Not seen yet")}
                  {d.seqConflict && <div className="mt-1 text-xs text-red-300">{d.seqConflict.reason}</div>}
                  {d.renumberRequested && (
                    <div className="mt-1 text-xs text-amber-300">Waiting for the PC to renumber its unsent work</div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">{d.pendingCount} waiting</td>
                <td className="px-4 py-3 text-sm text-slate-300">{d.appVersion ?? "—"}</td>
                <td className="px-4 py-3 text-sm">
                  {!d.revokedAt && d.seqConflict && (
                    <button
                      type="button"
                      aria-label={`Renumber ${d.name}`}
                      onClick={() => setConfirm({ id: d.id, action: "renumber" })}
                      className="mr-2 px-3 py-1 rounded-lg bg-violet-700 text-white hover:bg-violet-600"
                    >
                      Renumber unsent work
                    </button>
                  )}
                  {!d.revokedAt && (
                    <button
                      type="button"
                      aria-label={`Unpair ${d.name}`}
                      onClick={() => setConfirm({ id: d.id, action: "unpair" })}
                      className="px-3 py-1 rounded-lg bg-slate-700 text-white hover:bg-slate-600"
                    >
                      Unpair
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

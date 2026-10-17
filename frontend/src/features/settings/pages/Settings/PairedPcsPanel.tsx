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
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import type { PairedDeviceView } from "@liratek/core";
import logger from "@/utils/logger";
import { useFormat } from "@/i18n/useFormat";

/** Device states the server reports; anything else reads "Not seen yet". */
const STATE_KEYS = {
  standby: "pairedPcs.state.standby",
  blocked: "pairedPcs.state.blocked",
  offline: "pairedPcs.state.offline",
  finishing: "pairedPcs.state.finishing",
} as const;

function isKnownState(s: string | null | undefined): s is keyof typeof STATE_KEYS {
  return s != null && Object.prototype.hasOwnProperty.call(STATE_KEYS, s);
}

export default function PairedPcsPanel() {
  const api = useApi();
  const { t } = useTranslation(["settings", "common"]);
  const { formatDateTime } = useFormat();
  const when = (iso: string | null): string => {
    if (!iso) return t("pairedPcs.never");
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : formatDateTime(d);
  };
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
      else setError(r.error ?? t("pairedPcs.loadFailed"));
    } catch (err) {
      logger.error("Failed to load paired PCs:", err);
      setError(t("pairedPcs.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: number, action: "unpair" | "renumber") => {
    setBusy(true);
    try {
      const r = action === "unpair" ? await apiRef.current.revokePairedPc(id) : await apiRef.current.renumberPairedPc(id);
      await load();
      setError(r.success ? null : (r.error ?? (action === "unpair" ? t("pairedPcs.unpairFailed") : t("pairedPcs.renumberFailed"))));
    } catch (err) {
      logger.error("Paired PC action failed:", err);
      setError(t("pairedPcs.actionFailed"));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const confirming = devices.find((d) => d.id === confirm?.id);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">{t("pairedPcs.title")}</h2>
        <p className="text-sm text-slate-400">
          {t("pairedPcs.intro")}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {confirming && confirm && (
        <div role="dialog" aria-label={t("common:actions.confirm")} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-200">
            {confirm.action === "unpair"
              ? t("pairedPcs.confirmUnpair", { name: confirming.name })
              : t("pairedPcs.confirmRenumber", { name: confirming.name })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(confirming.id, confirm.action)}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm"
            >
              {t("common:actions.confirm")}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm">
              {t("common:actions.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-900">
            <tr>
              {[
                t("pairedPcs.col.pc"),
                t("pairedPcs.col.name"),
                t("pairedPcs.col.lastSeen"),
                t("pairedPcs.col.state"),
                t("pairedPcs.col.waiting"),
                t("pairedPcs.col.version"),
                "",
              ].map((h, i) => (
                <th key={i} className="text-start text-xs text-slate-400 px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {devices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-sm text-slate-400">
                  {t("pairedPcs.none")}
                </td>
              </tr>
            )}
            {devices.map((d) => (
              <tr key={d.id} className="hover:bg-slate-700/50">
                <td className="px-4 py-3 text-sm text-white">{t("pairedPcs.pcNo", { n: d.deviceNo })}</td>
                <td className="px-4 py-3 text-sm text-white">{d.name}</td>
                <td className="px-4 py-3 text-sm text-slate-300">{when(d.lastSeenAt)}</td>
                <td className="px-4 py-3 text-sm text-slate-300">
                  {d.revokedAt
                    ? t("pairedPcs.unpaired")
                    : isKnownState(d.state)
                      ? t(STATE_KEYS[d.state])
                      : t("pairedPcs.notSeen")}
                  {d.seqConflict && <div className="mt-1 text-xs text-red-300">{d.seqConflict.reason}</div>}
                  {d.renumberRequested && (
                    <div className="mt-1 text-xs text-amber-300">{t("pairedPcs.renumberWaiting")}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300">{t("pairedPcs.waitingCount", { n: d.pendingCount })}</td>
                <td className="px-4 py-3 text-sm text-slate-300">{d.appVersion ?? "—"}</td>
                <td className="px-4 py-3 text-sm">
                  {!d.revokedAt && d.seqConflict && (
                    <button
                      type="button"
                      aria-label={t("pairedPcs.renumberAria", { name: d.name })}
                      onClick={() => setConfirm({ id: d.id, action: "renumber" })}
                      className="me-2 px-3 py-1 rounded-lg bg-violet-700 text-white hover:bg-violet-600"
                    >
                      {t("pairedPcs.renumber")}
                    </button>
                  )}
                  {!d.revokedAt && (
                    <button
                      type="button"
                      aria-label={t("pairedPcs.unpairAria", { name: d.name })}
                      onClick={() => setConfirm({ id: d.id, action: "unpair" })}
                      className="px-3 py-1 rounded-lg bg-slate-700 text-white hover:bg-slate-600"
                    >
                      {t("pairedPcs.unpair")}
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

/**
 * Settings › Backup (web app, admins) — "Download backup": a SQLite file of
 * this shop's own data, named `liratek-<shop>-<YYYY-MM-DD-HHmm>.db` in the
 * browser's local time (rule 27). Sign-in sessions and one-time links are
 * not in the file.
 *
 * Web-only: the desktop app keeps its local backups on Settings ›
 * Diagnostics, so this renders nothing there (`isElectron()`), and nothing
 * for a non-admin (the server refuses them too). Goes through `useApi()`
 * (rule 19); `api` is read through a ref (rule 25).
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@liratek/ui";
import { isElectron } from "@/api/backendApi";
import { useAuth } from "@/features/auth/context/AuthContext";
import logger from "@/utils/logger";
import { backupStamp } from "./backupStamp";

const REVOKE_AFTER_MS = 10_000;

export default function ShopBackupPanel() {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const { user } = useAuth();
  const { t } = useTranslation("settings");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isElectron() || user?.role !== "admin") return null;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiRef.current.downloadShopBackup({ stamp: backupStamp() });
      if (!r.success || !r.data) {
        setError(r.error ?? t("backup.failed"));
        return;
      }
      const url = URL.createObjectURL(r.data.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked later, not in the same tick: some browsers (Safari, older
      // Firefox) cancel a download whose URL is revoked straight away.
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    } catch (err) {
      logger.error("Backup download failed:", err);
      setError(t("backup.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">{t("backup.title")}</h2>
        <p className="text-sm text-slate-400">{t("backup.intro")}</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void download()}
        className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-50"
      >
        {busy ? t("backup.preparing") : t("backup.download")}
      </button>
    </div>
  );
}

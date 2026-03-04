import { useEffect, useState } from "react";
import UpdatesPanel from "./UpdatesPanel";
import { appEvents, Select } from "@liratek/ui";

export default function Diagnostics() {
  const [errors, setErrors] = useState<
    Array<{ id: number; endpoint: string; error: string; created_at: string }>
  >([]);
  const [loading, setLoading] = useState(false);

  const [fkCheckLoading, setFkCheckLoading] = useState(false);
  const [fkCheckError, setFkCheckError] = useState<string | null>(null);

  const [backups, setBackups] = useState<
    Array<{ path: string; filename: string; createdAtMs: number }>
  >([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [selectedBackupPath, setSelectedBackupPath] = useState<string>("");
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [lastVerifyAt, setLastVerifyAt] = useState<string | null>(null);
  const [lastVerifyOk, setLastVerifyOk] = useState<boolean | null>(null);
  const [autoVerifyEnabled, setAutoVerifyEnabled] = useState<boolean | null>(
    null,
  );

  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean | null>(
    null,
  );
  const [autoBackupIntervalHours, setAutoBackupIntervalHours] = useState<
    number | null
  >(null);
  const [autoBackupKeepCount, setAutoBackupKeepCount] = useState<number | null>(
    null,
  );

  const [fkStartupViolationCount, setFkStartupViolationCount] = useState<
    number | null
  >(null);
  const [fkStartupCheckedAt, setFkStartupCheckedAt] = useState<string | null>(
    null,
  );

  const load = async () => {
    setLoading(true);
    try {
      const rows = await window.api.diagnostics.getSyncErrors();
      setErrors(rows);
    } finally {
      setLoading(false);
    }
  };

  const runForeignKeyCheck = async () => {
    setFkCheckLoading(true);
    setFkCheckError(null);
    try {
      const res = await window.api.diagnostics.foreignKeyCheck();
      if (!res.success) throw new Error(res.error || "FK check failed");
      const rows = res.rows || [];
      if (rows.length === 0) {
        appEvents.emit(
          "notification:show",
          "No foreign key violations found",
          "success",
        );
      } else {
        appEvents.emit(
          "notification:show",
          `Found ${rows.length} FK violation(s)`,
          "warning",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "FK check failed";
      setFkCheckError(msg);
      appEvents.emit("notification:show", msg, "error");
    } finally {
      setFkCheckLoading(false);
    }
  };

  const loadBackups = async () => {
    setBackupLoading(true);
    setBackupError(null);
    setVerifyResult(null);
    try {
      const [res, settings] = await Promise.all([
        window.api.report.listBackups(),
        window.api.settings?.getAll?.() ?? Promise.resolve([]),
      ]);

      if (!res.success) throw new Error(res.error || "Failed to list backups");

      const map = new Map(settings.map((s) => [s.key_name, s.value]));
      setLastBackupAt(String(map.get("last_backup_at") ?? "") || null);
      setLastVerifyAt(String(map.get("last_backup_verify_at") ?? "") || null);
      setLastVerifyOk(
        map.get("last_backup_verify_ok") == null
          ? null
          : String(map.get("last_backup_verify_ok")) === "1",
      );
      setAutoVerifyEnabled(
        Number(map.get("auto_backup_verify_enabled") ?? 0) === 1,
      );

      setFkStartupCheckedAt(String(map.get("fk_last_check_at") ?? "") || null);
      const fkCount = Number(map.get("fk_last_violation_count") ?? "");
      setFkStartupViolationCount(isFinite(fkCount) ? fkCount : null);

      setAutoBackupEnabled(Number(map.get("auto_backup_enabled") ?? 1) === 1);
      const intervalH = Number(map.get("auto_backup_interval_hours") ?? 24);
      setAutoBackupIntervalHours(isFinite(intervalH) ? intervalH : 24);
      const keepC = Number(map.get("auto_backup_keep_count") ?? 30);
      setAutoBackupKeepCount(isFinite(keepC) ? keepC : 30);

      const list = res.backups || [];
      setBackups(list);
      setSelectedBackupPath((prev) => prev || list[0]?.path || "");
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : "Failed to load backups");
    } finally {
      setBackupLoading(false);
    }
  };

  const backupNow = async () => {
    setBackupLoading(true);
    setBackupError(null);
    setVerifyResult(null);
    try {
      const res = await window.api.report.backupDatabase();
      if (!res.success) throw new Error(res.error || "Backup failed");
      appEvents.emit(
        "notification:show",
        "Backup created successfully",
        "success",
      );
      await loadBackups();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Backup failed";
      setBackupError(msg);
      appEvents.emit("notification:show", msg, "error");
    } finally {
      setBackupLoading(false);
    }
  };

  const verifySelected = async () => {
    if (!selectedBackupPath) return;
    setBackupLoading(true);
    setBackupError(null);
    setVerifyResult(null);
    try {
      const res = await window.api.report.verifyBackup(selectedBackupPath);
      if (!res.success) throw new Error(res.error || "Verify failed");
      setVerifyResult(res.ok ? "OK" : "FAILED");
      appEvents.emit(
        "notification:show",
        res.ok
          ? "Backup integrity check passed"
          : "Backup integrity check FAILED",
        res.ok ? "success" : "error",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verify failed";
      setBackupError(msg);
      appEvents.emit("notification:show", msg, "error");
    } finally {
      setBackupLoading(false);
    }
  };

  const restoreSelected = async () => {
    if (!selectedBackupPath) return;
    if (
      !confirm(
        "Restore will replace the local database and restart the app. Continue?",
      )
    )
      return;

    setBackupLoading(true);
    setBackupError(null);
    setVerifyResult(null);
    try {
      const res = await window.api.report.restoreDatabase(selectedBackupPath);
      if (!res.success) throw new Error(res.error || "Restore failed");
      appEvents.emit(
        "notification:show",
        "Restore successful — restarting app...",
        "success",
      );
      // If successful, the main process will relaunch and exit.
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Restore failed";
      setBackupError(msg);
      appEvents.emit("notification:show", msg, "error");
      setBackupLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadBackups();
  }, []);

  return (
    <div className="space-y-8">
      {/* FK Check */}
      <div className="space-y-3">
        {fkStartupViolationCount != null && fkStartupViolationCount > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-yellow-100 text-sm">
            Startup FK check found {fkStartupViolationCount} violation(s)
            {fkStartupCheckedAt
              ? ` (checked at ${new Date(fkStartupCheckedAt).toLocaleString()})`
              : ""}
            . Run FK Check Now for details.
          </div>
        )}
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">Foreign Key Check</h3>
          <button
            onClick={runForeignKeyCheck}
            disabled={fkCheckLoading}
            className="px-3 py-1 bg-slate-700 rounded text-white text-sm"
          >
            {fkCheckLoading ? "Checking..." : "Run FK Check Now"}
          </button>
        </div>

        {fkCheckError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-200 text-sm">
            {fkCheckError}
          </div>
        )}
      </div>

      {/* Updates */}
      <UpdatesPanel />

      {/* Backups */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold">Local Backups</h3>
            {(() => {
              const intervalMs =
                autoBackupIntervalHours != null
                  ? autoBackupIntervalHours * 60 * 60 * 1000
                  : null;
              const next =
                lastBackupAt && intervalMs
                  ? new Date(new Date(lastBackupAt).getTime() + intervalMs)
                  : null;

              return (
                <div className="text-xs text-slate-500 mt-1 space-y-1">
                  <div>
                    Last backup:{" "}
                    {lastBackupAt
                      ? new Date(lastBackupAt).toLocaleString()
                      : "—"}
                  </div>
                  <div>
                    Auto backup:{" "}
                    {autoBackupEnabled == null
                      ? "—"
                      : autoBackupEnabled
                        ? `Enabled (every ${autoBackupIntervalHours ?? 24}h, keep ${autoBackupKeepCount ?? 30})`
                        : "Disabled"}
                  </div>
                  <div>
                    Next backup:{" "}
                    {autoBackupEnabled === false
                      ? "—"
                      : next
                        ? next.toLocaleString()
                        : "After first successful backup"}
                  </div>
                  <div>
                    Auto verify:{" "}
                    {autoVerifyEnabled == null
                      ? "—"
                      : autoVerifyEnabled
                        ? "Enabled"
                        : "Disabled"}
                  </div>
                  <div>
                    Last verify:{" "}
                    {lastVerifyAt
                      ? `${new Date(lastVerifyAt).toLocaleString()} (${lastVerifyOk ? "OK" : "FAILED"})`
                      : "—"}
                  </div>
                  <div>Directory: Documents/LiratekBackups</div>
                </div>
              );
            })()}
          </div>
          <button
            onClick={backupNow}
            disabled={backupLoading}
            className="px-3 py-1 bg-violet-600 rounded text-white text-sm"
          >
            Backup Now
          </button>
        </div>

        {backupError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-200 text-sm">
            {backupError}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
          <Select
            value={selectedBackupPath}
            onChange={(value) => setSelectedBackupPath(value)}
            options={[
              { value: "", label: "Select a backup..." },
              ...backups.map((b) => ({
                value: b.path,
                label: b.filename,
              })),
            ]}
            ringColor="ring-violet-500"
            buttonClassName="bg-slate-900"
            className="w-full md:flex-1"
          />

          <button
            onClick={verifySelected}
            disabled={backupLoading || !selectedBackupPath}
            className="px-3 py-2 bg-slate-700 rounded text-white text-sm"
          >
            Verify
          </button>
          <button
            onClick={restoreSelected}
            disabled={backupLoading || !selectedBackupPath}
            className="px-3 py-2 bg-red-600 rounded text-white text-sm"
          >
            Restore
          </button>
        </div>

        {verifyResult && (
          <div className="text-sm text-slate-300">
            Integrity check:{" "}
            <span className="font-semibold">{verifyResult}</span>
          </div>
        )}

        {backupLoading && (
          <div className="text-sm text-slate-500">Working...</div>
        )}
      </div>

      {/* Sync Errors */}
      <div className="space-y-4">
        <h3 className="text-white font-semibold">Sync Errors</h3>
        <div className="border border-slate-700 rounded overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Endpoint</th>
                <th className="p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} className="p-3 text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : errors.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-3 text-slate-500">
                    No errors
                  </td>
                </tr>
              ) : (
                errors.map((e) => (
                  <tr key={e.id} className="border-t border-slate-800">
                    <td className="p-2 text-xs text-slate-400">
                      {e.created_at}
                    </td>
                    <td className="p-2 font-mono text-xs">{e.endpoint}</td>
                    <td className="p-2 text-sm">{e.error}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

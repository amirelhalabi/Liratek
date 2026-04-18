import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import UpdatesPanel from "./UpdatesPanel";
import { appEvents, useApi } from "@liratek/ui";

export default function Diagnostics() {
  const api = useApi();
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
  const [backupDir, setBackupDir] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbPathSource, setDbPathSource] = useState<string | null>(null);

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
      const [res, settings, dirRes] = await Promise.all([
        window.api.report.listBackups(),
        window.api.settings?.getAll?.() ?? Promise.resolve([]),
        window.api.report.getBackupDir(),
      ]);

      if (!res.success) throw new Error(res.error || "Failed to list backups");
      if (dirRes.success && dirRes.path) setBackupDir(dirRes.path);

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

  const changeBackupDir = async () => {
    try {
      const pickResult = await window.api.report.pickBackupDir();
      if (!pickResult.success || pickResult.canceled || !pickResult.path)
        return;

      const setResult = await window.api.report.setBackupDir(pickResult.path);
      if (!setResult.success) {
        appEvents.emit(
          "notification:show",
          `Failed: ${setResult.error}`,
          "error",
        );
        return;
      }

      setBackupDir(setResult.path ?? pickResult.path);
      appEvents.emit(
        "notification:show",
        "Backup directory updated",
        "success",
      );
      await loadBackups();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to change backup directory";
      appEvents.emit("notification:show", msg, "error");
    }
  };

  const saveBackupConfig = async () => {
    setSavingConfig(true);
    try {
      const intervalH = autoBackupIntervalHours ?? 24;
      const keepC = autoBackupKeepCount ?? 30;
      if (intervalH < 1) throw new Error("Interval must be >= 1 hour");
      if (keepC < 1) throw new Error("Keep count must be >= 1");

      await Promise.all([
        api.updateSetting("auto_backup_enabled", autoBackupEnabled ? "1" : "0"),
        api.updateSetting("auto_backup_interval_hours", String(intervalH)),
        api.updateSetting("auto_backup_keep_count", String(keepC)),
        api.updateSetting(
          "auto_backup_verify_enabled",
          autoVerifyEnabled ? "1" : "0",
        ),
      ]);
      appEvents.emit("notification:show", "Backup settings saved", "success");
    } catch (e) {
      appEvents.emit(
        "notification:show",
        e instanceof Error ? e.message : "Failed to save",
        "error",
      );
    } finally {
      setSavingConfig(false);
    }
  };

  useEffect(() => {
    load();
    loadBackups();
    // Load database path
    window.api?.diagnostics
      ?.getDbPath?.()
      .then(
        (
          res:
            | {
                success: boolean;
                path?: string;
                source?: string;
                error?: string;
              }
            | undefined,
        ) => {
          if (res?.success) {
            setDbPath(res.path ?? null);
            setDbPathSource(res.source ?? null);
          } else {
            setDbPath(res?.error ?? "Failed to resolve");
          }
        },
      )
      .catch(() => {
        setDbPath("IPC call failed");
      });
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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">Local Backups</h3>
          <button
            onClick={backupNow}
            disabled={backupLoading}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded text-white text-sm transition-colors"
          >
            {backupLoading ? "Working..." : "Backup Now"}
          </button>
        </div>

        {backupError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-200 text-sm">
            {backupError}
          </div>
        )}

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
          <div className="text-slate-400">Database</div>
          <div
            className="text-slate-200 font-mono text-xs truncate"
            title={dbPath ?? undefined}
          >
            {dbPath ?? "—"}
            {dbPathSource && (
              <span className="ml-2 text-slate-500 font-sans text-[10px]">
                ({dbPathSource})
              </span>
            )}
          </div>

          <div className="text-slate-400">Last backup</div>
          <div className="text-slate-200">
            {lastBackupAt ? new Date(lastBackupAt).toLocaleString() : "—"}
          </div>

          <div className="text-slate-400">Last verify</div>
          <div className="text-slate-200">
            {lastVerifyAt
              ? `${new Date(lastVerifyAt).toLocaleString()} (${lastVerifyOk ? "OK" : "FAILED"})`
              : "—"}
          </div>

          <div className="text-slate-400">Directory</div>
          <div className="flex items-center gap-2">
            <span className="text-slate-200 font-mono text-xs truncate">
              {backupDir ?? "Documents/Liratek/Backups"}
            </span>
            <button
              onClick={changeBackupDir}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded transition-colors shrink-0"
              title="Change backup directory"
            >
              <FolderOpen size={12} />
              Change
            </button>
          </div>
        </div>

        {/* Backup config */}
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 space-y-3">
          <div className="text-sm font-semibold text-white">
            Auto Backup Settings
          </div>

          <label className="flex items-center gap-2 text-slate-300 text-sm">
            <input
              type="checkbox"
              checked={autoBackupEnabled ?? true}
              onChange={(e) => setAutoBackupEnabled(e.target.checked)}
            />{" "}
            Enable automatic local backups
          </label>

          <label className="flex items-center gap-2 text-slate-300 text-sm">
            <input
              type="checkbox"
              checked={autoVerifyEnabled ?? false}
              onChange={(e) => setAutoVerifyEnabled(e.target.checked)}
            />{" "}
            Verify backups after creation
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 text-xs mb-1">
                Interval (hours)
              </label>
              <input
                type="number"
                min={1}
                value={autoBackupIntervalHours ?? 24}
                onChange={(e) =>
                  setAutoBackupIntervalHours(Number(e.target.value))
                }
                className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm w-full focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">
                Keep (count)
              </label>
              <input
                type="number"
                min={1}
                value={autoBackupKeepCount ?? 30}
                onChange={(e) => setAutoBackupKeepCount(Number(e.target.value))}
                className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm w-full focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveBackupConfig}
              disabled={savingConfig}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-white text-sm transition-colors"
            >
              {savingConfig ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>

        {/* Backup file + actions */}
        <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50 space-y-3">
          <div className="text-sm text-slate-400">Selected backup</div>
          <div className="flex items-center gap-2">
            <span className="text-slate-200 font-mono text-xs truncate flex-1">
              {selectedBackupPath
                ? (backups.find((b) => b.path === selectedBackupPath)
                    ?.filename ?? selectedBackupPath)
                : "No backup selected"}
            </span>
            {backups.length > 1 && (
              <select
                value={selectedBackupPath}
                onChange={(e) => setSelectedBackupPath(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-violet-500 shrink-0"
              >
                {backups.map((b) => (
                  <option key={b.path} value={b.path}>
                    {b.filename}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={verifySelected}
              disabled={backupLoading || !selectedBackupPath}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:hover:bg-slate-700 rounded text-white text-sm transition-colors"
            >
              Verify Integrity
            </button>
            <button
              onClick={restoreSelected}
              disabled={backupLoading || !selectedBackupPath}
              className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 disabled:hover:bg-red-600/80 rounded text-white text-sm transition-colors"
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
        </div>
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

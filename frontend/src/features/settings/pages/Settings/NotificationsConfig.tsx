import { useEffect, useState } from "react";
import { appEvents } from "@liratek/ui";
import * as api from "../../../../api/backendApi";

export default function NotificationsConfig() {
  const [pollMs, setPollMs] = useState("60000");
  const [warnLow, setWarnLow] = useState(true);
  const [warnDrawer, setWarnDrawer] = useState(true);

  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);
  const [autoBackupIntervalHours, setAutoBackupIntervalHours] = useState("24");
  const [autoBackupKeepCount, setAutoBackupKeepCount] = useState("30");
  const [autoBackupVerifyEnabled, setAutoBackupVerifyEnabled] = useState(false);

  const [saving, setSaving] = useState(false);

  const load = async () => {
    const settings = await api.getAllSettings();
    const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
    setPollMs(String(map.get("notifications_poll_interval_ms") || "60000"));
    setWarnLow(Number(map.get("notifications_warn_low_stock") ?? 1) === 1);
    setWarnDrawer(
      Number(map.get("notifications_warn_drawer_limits") ?? 1) === 1,
    );

    setAutoBackupEnabled(Number(map.get("auto_backup_enabled") ?? 1) === 1);
    setAutoBackupIntervalHours(
      String(map.get("auto_backup_interval_hours") || "24"),
    );
    setAutoBackupKeepCount(String(map.get("auto_backup_keep_count") || "30"));
    setAutoBackupVerifyEnabled(
      Number(map.get("auto_backup_verify_enabled") ?? 0) === 1,
    );
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const v = Number(pollMs);
      if (!isFinite(v) || v < 10000)
        throw new Error("Poll interval must be >= 10000");
      const intervalHoursNum = Number(autoBackupIntervalHours);
      const keepCountNum = Number(autoBackupKeepCount);
      if (!isFinite(intervalHoursNum) || intervalHoursNum < 1)
        throw new Error("Auto-backup interval hours must be >= 1");
      if (!isFinite(keepCountNum) || keepCountNum < 1)
        throw new Error("Auto-backup keep count must be >= 1");

      await Promise.all([
        api.updateSetting("notifications_poll_interval_ms", String(v)),
        api.updateSetting("notifications_warn_low_stock", warnLow ? "1" : "0"),
        api.updateSetting(
          "notifications_warn_drawer_limits",
          warnDrawer ? "1" : "0",
        ),
        api.updateSetting("auto_backup_enabled", autoBackupEnabled ? "1" : "0"),
        api.updateSetting(
          "auto_backup_interval_hours",
          String(intervalHoursNum),
        ),
        api.updateSetting("auto_backup_keep_count", String(keepCountNum)),
        api.updateSetting(
          "auto_backup_verify_enabled",
          autoBackupVerifyEnabled ? "1" : "0",
        ),
      ]);
      appEvents.emit(
        "notification:show",
        "Notification preferences saved",
        "success",
      );
    } catch (e) {
      appEvents.emit(
        "notification:show",
        e instanceof Error ? e.message : "Failed to save",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-slate-300 text-sm">Polling Interval (ms)</label>
        <input
          value={pollMs}
          onChange={(e) => setPollMs(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white w-40"
        />
      </div>
      <label className="flex items-center gap-2 text-slate-300 text-sm">
        <input
          type="checkbox"
          checked={warnLow}
          onChange={(e) => setWarnLow(e.target.checked)}
        />{" "}
        Low-stock warnings
      </label>
      <label className="flex items-center gap-2 text-slate-300 text-sm">
        <input
          type="checkbox"
          checked={warnDrawer}
          onChange={(e) => setWarnDrawer(e.target.checked)}
        />{" "}
        Drawer-limit warnings
      </label>

      <div className="border-t border-slate-800 pt-4" />

      <h4 className="text-white font-semibold">Auto Backup</h4>

      <label className="flex items-center gap-2 text-slate-300 text-sm">
        <input
          type="checkbox"
          checked={autoBackupEnabled}
          onChange={(e) => setAutoBackupEnabled(e.target.checked)}
        />{" "}
        Enable automatic local backups
      </label>

      <label className="flex items-center gap-2 text-slate-300 text-sm">
        <input
          type="checkbox"
          checked={autoBackupVerifyEnabled}
          onChange={(e) => setAutoBackupVerifyEnabled(e.target.checked)}
        />{" "}
        Verify backups after creation
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-slate-300 text-sm">
            Interval (hours)
          </label>
          <input
            value={autoBackupIntervalHours}
            onChange={(e) => setAutoBackupIntervalHours(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white w-full"
          />
        </div>
        <div>
          <label className="block text-slate-300 text-sm">Keep (count)</label>
          <input
            value={autoBackupKeepCount}
            onChange={(e) => setAutoBackupKeepCount(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white w-full"
          />
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Backups are stored in Documents/LiratekBackups. Old backups are pruned
        automatically.
      </p>
      <div className="flex gap-2 justify-end">
        <button onClick={load} className="px-3 py-2 bg-slate-700 rounded">
          Reset
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-2 bg-violet-600 rounded text-white"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

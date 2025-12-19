import { useEffect, useState } from "react";
import { appEvents } from "../../../../shared/utils/appEvents";

export default function NotificationsConfig() {
  const [pollMs, setPollMs] = useState("60000");
  const [warnLow, setWarnLow] = useState(true);
  const [warnDrawer, setWarnDrawer] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const settings = await window.api.settings.getAll();
    const map = new Map(settings.map((s) => [s.key_name, s.value]));
    setPollMs(String(map.get("notifications_poll_interval_ms") || "60000"));
    setWarnLow(Number(map.get("notifications_warn_low_stock") ?? 1) === 1);
    setWarnDrawer(
      Number(map.get("notifications_warn_drawer_limits") ?? 1) === 1,
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
      await Promise.all([
        window.api.settings.update("notifications_poll_interval_ms", String(v)),
        window.api.settings.update(
          "notifications_warn_low_stock",
          warnLow ? "1" : "0",
        ),
        window.api.settings.update(
          "notifications_warn_drawer_limits",
          warnDrawer ? "1" : "0",
        ),
      ]);
      appEvents.emit("notification:show", "Notification preferences saved", "success");
    } catch (e) {
      appEvents.emit("notification:show", (e instanceof Error ? e.message : "Failed to save"), "error");
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

import { useEffect, useState } from "react";
import { appEvents, useApi } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { normalizeDigits } from "@liratek/ui/i18n/digits";
import {
  SETTINGS_FORM_WIDTH,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PRIMARY_BUTTON,
  SETTINGS_SECONDARY_BUTTON,
} from "./settingsUi";

export default function NotificationsConfig() {
  const { t } = useTranslation(["settings", "common"]);
  const api = useApi();
  const [pollMs, setPollMs] = useState("60000");
  const [warnLow, setWarnLow] = useState(true);

  const [saving, setSaving] = useState(false);

  const load = async () => {
    const settings = await api.getAllSettings();
    const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
    setPollMs(String(map.get("notifications_poll_interval_ms") || "60000"));
    setWarnLow(Number(map.get("notifications_warn_low_stock") ?? 1) === 1);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const v = Number(pollMs);
      if (!isFinite(v) || v < 10000)
        throw new Error(t("notifications.pollTooLow"));

      await Promise.all([
        api.updateSetting("notifications_poll_interval_ms", String(v)),
        api.updateSetting("notifications_warn_low_stock", warnLow ? "1" : "0"),
      ]);
      appEvents.emit(
        "notification:show",
        t("notifications.saved"),
        "success",
      );
    } catch (e) {
      appEvents.emit(
        "notification:show",
        e instanceof Error ? e.message : t("notifications.saveFailed"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`space-y-4 ${SETTINGS_FORM_WIDTH}`}>
      <div>
        <label htmlFor="notifications-poll-interval" className={SETTINGS_LABEL}>
          {t("notifications.pollInterval")}
        </label>
        <input
          id="notifications-poll-interval"
          inputMode="numeric"
          value={pollMs}
          onChange={(e) => setPollMs(normalizeDigits(e.target.value))}
          className={`${SETTINGS_INPUT} max-w-xs`}
        />
      </div>
      <label className="flex items-center gap-2 text-slate-400 text-sm">
        <input
          type="checkbox"
          checked={warnLow}
          onChange={(e) => setWarnLow(e.target.checked)}
        />{" "}
        {t("notifications.lowStock")}
      </label>

      <div className="flex gap-2">
        <button onClick={load} className={SETTINGS_SECONDARY_BUTTON}>
          {t("notifications.reset")}
        </button>
        <button
          onClick={save}
          disabled={saving}
          data-testid="notifications-save"
          className={SETTINGS_PRIMARY_BUTTON}
        >
          {saving ? t("common:state.saving") : t("common:actions.save")}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { appEvents, useApi } from "@liratek/ui";
import { PROFITS_PASSWORD_MIN_LENGTH } from "@liratek/core";
import { useTranslation } from "react-i18next";
import {
  SETTINGS_FORM_WIDTH,
  SETTINGS_INPUT,
  SETTINGS_LABEL,
  SETTINGS_PRIMARY_BUTTON,
} from "./settingsUi";

/**
 * Settings › Profits Password (PROFITS_GATE_CONTRACT.md). Only an admin
 * reaches this tab (Settings is behind AdminRoute), and only an admin can
 * set the password (`profits:set-password` / `PUT /api/profits/password`
 * are admin-only server-side too). Deliberately allows a short PIN
 * (`PROFITS_PASSWORD_MIN_LENGTH` = 4) — NOT the 8-char complexity rule used
 * for user account passwords; this gate protects a single shared page, not
 * a login.
 */
export default function ProfitsPasswordPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const api = useApi();
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setStatusLoading(true);
    try {
      const { isSet } = await api.getProfitsPasswordStatus();
      setIsSet(isSet);
    } catch {
      setIsSet(null);
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setError(null);
    if (newPassword.length < PROFITS_PASSWORD_MIN_LENGTH) {
      setError(
        t("profitsPassword.tooShort", { min: PROFITS_PASSWORD_MIN_LENGTH }),
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("profitsPassword.mismatch"));
      return;
    }
    setSaving(true);
    try {
      const res = await api.setProfitsPassword(newPassword);
      if (res.success) {
        setNewPassword("");
        setConfirmPassword("");
        appEvents.emit(
          "notification:show",
          t("profitsPassword.saved"),
          "success",
        );
        await loadStatus();
      } else {
        setError(res.error || t("profitsPassword.saveFailed"));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("profitsPassword.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-testid="profits-password-panel"
      className={`space-y-4 ${SETTINGS_FORM_WIDTH}`}
    >
      <div
        data-testid="profits-password-status"
        className="text-sm text-slate-300"
      >
        {statusLoading
          ? t("profitsPassword.checking")
          : isSet === null
            ? t("profitsPassword.unknown")
            : isSet
              ? t("profitsPassword.isSet")
              : t("profitsPassword.notSet")}
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm bg-red-500/15 border border-red-500/40 text-red-300">
          {error}
        </div>
      )}

      <div>
        <label className={SETTINGS_LABEL}>
          {t("profitsPassword.new")}
        </label>
        <input
          type="password"
          data-testid="profits-password-new"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={SETTINGS_INPUT}
        />
      </div>

      <div>
        <label className={SETTINGS_LABEL}>
          {t("profitsPassword.confirm")}
        </label>
        <input
          type="password"
          data-testid="profits-password-confirm"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={SETTINGS_INPUT}
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        data-testid="profits-password-save"
        className={SETTINGS_PRIMARY_BUTTON}
      >
        {saving ? t("common:state.saving") : t("profitsPassword.save")}
      </button>
    </div>
  );
}

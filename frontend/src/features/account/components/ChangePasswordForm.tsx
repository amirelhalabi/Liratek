/**
 * Change password — LIRA-293. For a user who HAS a password (a user who
 * joined with Google and has none uses "Set a password" instead). Shown in
 * My account's Sign-in methods on the web, and on its own on the desktop
 * app (desktop users always have a password).
 *
 * Current, new and confirm, each a PasswordInput with the right
 * autoComplete so password managers fill the current one and save the new
 * one. The new password is checked with the ONE core rule before the call;
 * the server checks again. One call through the dual-transport adapter
 * (desktop IPC / web REST, rule 19). On success the user's OTHER devices are
 * signed out; this one stays signed in.
 */

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { validatePasswordComplexity } from "@liratek/core";
import { changeOwnPassword } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import PasswordInput from "@/shared/components/PasswordInput";

export default function ChangePasswordForm({
  onCancel,
}: {
  onCancel?: () => void;
}) {
  const { t } = useTranslation("account");
  const FAILED = t("changePassword.failed");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (!current) {
      setError(t("changePassword.enterCurrent"));
      return;
    }
    const policy = validatePasswordComplexity(next);
    if (!policy.valid) {
      setError(policy.errors.join(". "));
      return;
    }
    if (next !== confirm) {
      setError(t("changePassword.mismatch"));
      return;
    }
    setBusy(true);
    try {
      const res = await changeOwnPassword({
        currentPassword: current,
        newPassword: next,
      });
      if (!res.success) {
        setError(messageFrom(res.error, FAILED));
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      const others = res.data?.sessionsRevoked ?? 0;
      setDone(
        others > 0
          ? t(
              others === 1
                ? "changePassword.changedOneDevice"
                : "changePassword.changedDevices",
              { count: others },
            )
          : t("changePassword.changed"),
      );
    } catch (err) {
      setError(messageFrom(err, FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label={t("changePassword.title")}
      className="mt-3 space-y-3"
    >
      <h4 className="text-sm font-medium text-white">
        {t("changePassword.title")}
      </h4>
      <PasswordInput
        label={t("changePassword.current")}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        name="current-password"
        id="change-password-current"
      />
      <PasswordInput
        label={t("changePassword.new")}
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        name="new-password"
        id="change-password-new"
        showStrength
      />
      <PasswordInput
        label={t("changePassword.confirm")}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        name="confirm-password"
        id="change-password-confirm"
      />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-green-400">
          {done}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {t("changePassword.title")}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-white disabled:opacity-60"
          >
            {t("changePassword.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

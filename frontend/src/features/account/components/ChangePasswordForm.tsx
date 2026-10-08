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
import { validatePasswordComplexity } from "@liratek/core";
import { changeOwnPassword } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import PasswordInput from "@/shared/components/PasswordInput";

const FAILED = "Could not change the password.";

export default function ChangePasswordForm() {
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
      setError("Enter your current password.");
      return;
    }
    const policy = validatePasswordComplexity(next);
    if (!policy.valid) {
      setError(policy.errors.join(". "));
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match.");
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
          ? `Password changed. ${others} other device${others === 1 ? " was" : "s were"} signed out.`
          : "Password changed.",
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
      aria-label="Change password"
      className="mt-3 space-y-3"
    >
      <h4 className="text-sm font-medium text-white">Change password</h4>
      <PasswordInput
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        name="current-password"
        id="change-password-current"
      />
      <PasswordInput
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        name="new-password"
        id="change-password-new"
        showStrength
      />
      <PasswordInput
        label="Confirm new password"
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
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
      >
        Change password
      </button>
    </form>
  );
}

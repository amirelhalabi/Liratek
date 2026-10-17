/**
 * Choose a new password from an emailed link (LIRA-275/276) — web only,
 * route `/reset-password?token=…`.
 *
 * The link is checked ONCE on load (the check route has a per-IP limiter),
 * then the person types the new password twice. The rule shown and enforced
 * here is the server's own (`validatePasswordComplexity`, the same rule
 * `newPasswordSchema` applies), so the form never accepts a password the
 * server refuses. On success every device signed in to that account is
 * signed out, and the page links to sign-in.
 *
 * LIRA-291: for a user with NO password (joined with Google) the page says
 * "Set a password" instead of "Choose a new password" (the check tells it).
 * Both fields are `PasswordInput`s — show/hide eyes, `autocomplete=
 * "new-password"` and distinct name/id, so a browser can generate and save
 * the password.
 */

import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  PASSWORD_REQUIREMENTS,
  PASSWORD_RESET_INVALID_MESSAGE,
  validatePasswordComplexity,
} from "@liratek/core";
import type {
  PasswordResetCheckResult,
  ResetPasswordInput,
} from "@liratek/core";
import { checkResetToken, isElectron, resetPassword } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import PasswordInput from "@/shared/components/PasswordInput";
import { useTheme } from "@/contexts/ThemeContext";
import logger from "@/utils/logger";
import { useTranslation } from "react-i18next";

type Entry =
  | { kind: "loading" }
  | { kind: "valid"; target: PasswordResetCheckResult }
  | { kind: "invalid"; message: string };

export default function ResetPassword() {
  const { t } = useTranslation("auth");
  const { t: tc } = useTranslation("common");
  const UNREACHABLE = t("shared.unreachable");
  const { theme } = useTheme();
  const dark = theme === "dark";
  const desktop = isElectron();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() || null;

  const [entry, setEntry] = useState<Entry>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ loginUrl: string | null } | null>(null);

  // Check each link ONCE: the ref (not a `cancelled` flag) is what makes
  // StrictMode's mount -> cleanup -> mount run a single request. The API
  // function is a module import (stable), not a dependency (rule 25).
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (desktop) return;
    const key = token ?? "";
    if (checkedFor.current === key) return;
    checkedFor.current = key;

    if (!token) {
      setEntry({ kind: "invalid", message: PASSWORD_RESET_INVALID_MESSAGE });
      return;
    }
    checkResetToken({ token })
      .then((res) => {
        if (res.success && res.data) {
          setEntry({ kind: "valid", target: res.data });
          return;
        }
        setEntry({
          kind: "invalid",
          message: messageFrom(res.error, PASSWORD_RESET_INVALID_MESSAGE),
        });
      })
      .catch((err: unknown) => {
        logger.error("Reset link check failed:", err);
        setEntry({ kind: "invalid", message: messageFrom(err, UNREACHABLE) });
      });
  }, [desktop, token, UNREACHABLE]);

  const policy = validatePasswordComplexity(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    entry.kind === "valid" &&
    token !== null &&
    policy.valid &&
    confirm === password &&
    !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !token) return;
    setError("");
    setSaving(true);
    try {
      // Built ONCE (rule 22); typed by the core schema's input (rule 21).
      const payload: ResetPasswordInput = { token, password };
      const res = await resetPassword(payload);
      if (res.success) {
        setDone({ loginUrl: res.data?.loginUrl ?? null });
        return;
      }
      setError(messageFrom(res.error, PASSWORD_RESET_INVALID_MESSAGE));
    } catch (err) {
      logger.error("Password reset failed:", err);
      setError(messageFrom(err, UNREACHABLE));
    } finally {
      setSaving(false);
    }
  };

  const pageClass = clsx(
    "min-h-screen flex items-center justify-center p-6",
    dark ? "bg-slate-950" : "bg-gray-100",
  );
  const cardClass = clsx(
    "w-full max-w-md rounded-xl border p-6",
    dark ? "bg-slate-800 border-slate-700/50" : "bg-white border-gray-200",
  );
  const headingClass = clsx(
    "text-2xl font-bold",
    dark ? "text-white" : "text-gray-900",
  );
  const subtleClass = clsx(
    "text-sm",
    dark ? "text-slate-400" : "text-gray-600",
  );
  const hintClass = clsx(
    "mt-1 text-xs",
    dark ? "text-slate-500" : "text-gray-500",
  );
  const labelClass = clsx(
    "text-xs block mb-1",
    dark ? "text-slate-400" : "text-gray-600",
  );
  const inputClass = clsx(
    "w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500",
    dark
      ? "bg-slate-900 border-slate-600 text-white"
      : "bg-white border-gray-300 text-gray-900",
  );
  const errorBox = (message: string) => (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500"
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );

  if (desktop) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <h1 className={clsx(headingClass, "mb-2")}>{t("reset.title")}</h1>
          <p className={subtleClass}>{t("reset.desktopOnly")}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className={clsx(headingClass, "mb-2")}>
            {t("reset.changedTitle")}
          </h1>
          <p className={clsx(subtleClass, "mb-6")}>{t("reset.changedBody")}</p>
          {/* The shop's own address when the server knows it: a full page
              load to that origin, not a router link. */}
          {done.loginUrl ? (
            <a
              href={`${done.loginUrl}/#/login`}
              className="block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors text-center"
            >
              {t("shared.goToSignIn")}
            </a>
          ) : (
            <Link
              to="/login"
              className="block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors text-center"
            >
              {t("shared.goToSignIn")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (entry.kind === "loading") {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <p className={subtleClass}>{tc("state.loading")}</p>
        </div>
      </div>
    );
  }

  if (entry.kind === "invalid") {
    return (
      <div className={pageClass}>
        <div className={cardClass}>
          <h1 className={clsx(headingClass, "mb-4")}>{t("reset.title")}</h1>
          {errorBox(entry.message)}
          <p className={clsx("mt-4 text-center", subtleClass)}>
            <Link
              to="/forgot-password"
              className="text-orange-500 hover:text-orange-400"
            >
              {t("reset.askNewLink")}
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <form onSubmit={handleSubmit} className={cardClass}>
        <h1 className={clsx(headingClass, "mb-1")}>
          {entry.target.hasPassword === false
            ? t("reset.setPassword")
            : t("reset.chooseNew")}
        </h1>
        <p className={clsx(subtleClass, "mb-6")}>
          {t("reset.for")} <strong>{entry.target.username}</strong>{" "}
          {t("reset.at")} <strong>{entry.target.shopName}</strong>
          {t("reset.end")}
        </p>

        {error && errorBox(error)}

        <div className="space-y-4">
          <div>
            <PasswordInput
              label={t("reset.newPassword")}
              id="new-password"
              name="new-password"
              testId="reset-password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              placeholder=""
              labelClassName={labelClass}
              inputClassName={inputClass}
              required
            />
            {password.length > 0 && !policy.valid ? (
              <ul className={clsx(hintClass, "list-disc ps-4")}>
                {policy.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : (
              <p className={hintClass}>
                {t("reset.rule", { min: PASSWORD_REQUIREMENTS.minLength })}
              </p>
            )}
          </div>
          <div>
            <PasswordInput
              label={t("reset.confirmPassword")}
              id="confirm-password"
              name="confirm-password"
              testId="reset-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              placeholder=""
              labelClassName={labelClass}
              inputClassName={inputClass}
              required
            />
            {mismatch && (
              <p className="mt-1 text-xs text-red-500">{t("reset.mismatch")}</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className={clsx(
            "mt-6 w-full py-3 rounded-lg text-white font-semibold transition-colors",
            canSubmit
              ? "bg-orange-500 hover:bg-orange-600"
              : "bg-slate-600 cursor-not-allowed opacity-70",
          )}
        >
          {saving ? tc("state.saving") : t("reset.submit")}
        </button>
      </form>
    </div>
  );
}

/**
 * Sign-in methods (LIRA-280, LIRA-291). Web only; shown on "My account"
 * (/account, every role) because it is about how THIS user signs in. The
 * desktop app keeps it in Settings → Signed-in Devices, where it renders
 * nothing.
 *
 * The ONLY way an existing account gets linked to Google (owner decision
 * 2026-10-07): never automatically by matching an email. Connect asks the
 * server for the www start URL and a signed ticket that names the caller,
 * POSTs the ticket there as a form (never in a URL) and so leaves for Google; the callback returns here with
 * `/#/account?google=linked|already_linked|error|cancelled`, which this
 * panel reports once and removes from the address bar.
 *
 * LIRA-288: one Google account = one user PER SHOP, so the same account may
 * be connected here and in other shops; `already_linked` means another user
 * of THIS shop has it (or this user already has another one). The callback
 * no longer sends `in_other_shop`; its text is kept for one release for a
 * page left open from before.
 *
 * LIRA-291 — "Sign-in methods". A user who joined with Google has NO
 * password, so Google is their only way in: Disconnect is refused
 * (SET_PASSWORD_FIRST, enforced by the server too) and a "Set a password"
 * form is shown instead, using the one core password rule. Once a password
 * is set, Disconnect works.
 *
 * LIRA-293: a user WITH a password gets "Change password" here (current +
 * new). While Google sign-in is dormant (no GOOGLE_CLIENT_ID) the panel
 * still shows, with "Change password" or "Set a password" and no Google
 * buttons. Hidden on desktop (My account shows Change password there).
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  GOOGLE_ACCOUNT_IN_OTHER_SHOP_MESSAGE,
  SET_PASSWORD_FIRST_MESSAGE,
  validatePasswordComplexity,
} from "@liratek/core";
import {
  getMyEmail,
  googleLinkStart,
  googleLinkStatus,
  googleUnlink,
  isElectron,
  requestEmailChange,
  setInitialPassword,
  type OwnEmailView,
} from "@/api/backendApi";
import PasswordInput from "@/shared/components/PasswordInput";
import ChangePasswordForm from "@/features/account/components/ChangePasswordForm";
import { messageFrom } from "@/api/apiError";
import {
  hashQuery,
  removeHashParam,
  submitPostForm,
} from "@/features/auth/utils/browserNavigation";

/** The `?google=<code>` result codes the OAuth callback hands back. */
function resultText(
  code: string,
  t: TFunction<["settings", "common"]>,
): { ok: boolean; text: string } | null {
  switch (code) {
    case "linked":
      return { ok: true, text: t("google.result.linked") };
    case "already_linked":
      return { ok: false, text: t("google.result.already_linked") };
    // Deprecated (LIRA-288): no longer sent; kept for one release.
    case "in_other_shop":
      return { ok: false, text: GOOGLE_ACCOUNT_IN_OTHER_SHOP_MESSAGE };
    case "error":
      return { ok: false, text: t("google.result.error") };
    case "cancelled":
      return { ok: false, text: t("google.result.cancelled") };
    default:
      return null;
  }
}

interface LinkState {
  enabled: boolean;
  linked: boolean;
  email: string | null;
  hasPassword: boolean;
}

type OpenAction = "email" | "password" | "set-password" | null;


function ChangeEmailForm({
  onCancel,
  onSent,
}: {
  onCancel: () => void;
  onSent: (email: string) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await requestEmailChange({ email: value.trim() });
      if (!res.success || !res.data) {
        setError(messageFrom(res.error, t("google.changeEmailFailed")));
        return;
      }
      onSent(res.data.pendingEmail);
    } catch (err) {
      setError(messageFrom(err, t("google.changeEmailFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label={t("google.changeEmail")}
      className="mt-3 space-y-3"
    >
      <label
        htmlFor="change-email-new"
        className="block text-xs text-slate-400"
      >
        {t("google.newEmail")}
        <input
          id="change-email-new"
          type="email"
          autoComplete="email"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {t("google.sendLink")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-white disabled:opacity-60"
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    </form>
  );
}

export default function GoogleAccountPanel({
  accountEmail,
  emailLoaded: externalEmailLoaded,
  emailLoadError: externalEmailLoadError,
}: {
  accountEmail?: OwnEmailView | null;
  emailLoaded?: boolean;
  emailLoadError?: string | null;
} = {}) {
  const { t } = useTranslation(["settings", "common"]);
  const [state, setState] = useState<LinkState | null>(null);
  const [loadedEmail, setLoadedEmail] = useState<OwnEmailView | null>(null);
  const [loadedEmailLoaded, setLoadedEmailLoaded] = useState(false);
  const [loadedEmailError, setLoadedEmailError] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<OpenAction>(null);
  const [emailChangeSentTo, setEmailChangeSentTo] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    () => {
      if (isElectron()) return null;
      const result = hashQuery().get("google");
      return result ? resultText(result, t) : null;
    },
  );

  // The link result is reported once, then leaves the address bar.
  useEffect(() => {
    if (!isElectron()) removeHashParam("google");
  }, []);

  // LIRA-293: the panel shows whenever the server answers — with Google
  // sign-in off it still holds "Change password" (or "Set a password"), just
  // no Google buttons.
  const load = useCallback(async () => {
    if (isElectron()) return;
    try {
      const res = await googleLinkStatus();
      // An older server sends no hasPassword: treat it as "has a password".
      const hasPassword = res.data?.hasPassword !== false;
      if (res.success && res.data) {
        setState({
          enabled: res.data.enabled,
          linked: res.data.linked,
          email: res.data.email,
          hasPassword,
        });
      } else {
        setState(null);
      }
    } catch {
      // A backend that cannot answer cannot link either: stay hidden.
      setState(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isElectron() || externalEmailLoaded !== undefined) return;
    let cancelled = false;
    getMyEmail()
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setLoadedEmail(res.data ?? null);
          setLoadedEmailLoaded(true);
          setLoadedEmailError(null);
        } else {
          setLoadedEmailLoaded(true);
          setLoadedEmailError(
            messageFrom(res.error, t("google.loadEmailFailed")),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadedEmailLoaded(true);
          setLoadedEmailError(
            messageFrom(err, t("google.loadEmailFailed")),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [externalEmailLoaded, t]);

  if (!state) return null;

  const usesExternalEmail = externalEmailLoaded !== undefined;
  const email = usesExternalEmail ? accountEmail : loadedEmail;
  const emailLoaded = usesExternalEmail
    ? externalEmailLoaded
    : loadedEmailLoaded;
  const emailLoadError = usesExternalEmail
    ? externalEmailLoadError
    : loadedEmailError;

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await googleLinkStart();
      if (res.success && res.data?.url && res.data.ticket) {
        submitPostForm(res.data.url, {
          intent: "link",
          ticket: res.data.ticket,
        });
        return;
      }
      setNotice({
        ok: false,
        text: messageFrom(res.error, t("google.result.error")),
      });
    } catch (err) {
      setNotice({
        ok: false,
        text: messageFrom(err, t("google.result.error")),
      });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    // LIRA-291: Google is the only way in — the server refuses too.
    if (!state.hasPassword) {
      setNotice({ ok: false, text: SET_PASSWORD_FIRST_MESSAGE });
      return;
    }
    if (
      !confirm(
        t("google.disconnectConfirm"),
      )
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await googleUnlink();
      if (!res.success) {
        setNotice({
          ok: false,
          text: messageFrom(res.error, t("google.disconnectFailed")),
        });
      }
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: messageFrom(err, t("google.disconnectFailed")),
      });
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const policy = validatePasswordComplexity(newPassword);
    if (!policy.valid) {
      setFormError(policy.errors.join(". "));
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError(t("google.mismatch"));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await setInitialPassword({ password: newPassword });
      if (!res.success) {
        setFormError(messageFrom(res.error, t("google.setPasswordFailed")));
        return;
      }
      setNewPassword("");
      setConfirmPassword("");
      setOpenAction(null);
      setNotice({ ok: true, text: t("google.passwordSet") });
      await load();
    } catch (err) {
      setFormError(messageFrom(err, t("google.setPasswordFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("google.section")}
      className="mb-6 rounded-lg border border-slate-700 bg-slate-900/40 p-4"
    >
      {notice && (
        <p
          role="status"
          className={`mt-2 text-sm ${notice.ok ? "text-green-400" : "text-red-400"}`}
        >
          {notice.text}
        </p>
      )}
      <div className="divide-y divide-slate-700/70">
        <div className="py-3 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">
                {t("google.accountEmail")}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {emailLoadError ||
                  (!emailLoaded
                    ? t("google.loadingEmail")
                    : email?.email
                      ? email.emailVerifiedAt
                        ? t("google.verified")
                        : t("google.notVerified")
                      : t("google.noEmail"))}
              </p>
            </div>
            {openAction !== "email" && (
              <button
                type="button"
                onClick={() => {
                  setEmailChangeSentTo(null);
                  setOpenAction("email");
                }}
                disabled={!emailLoaded || !!emailLoadError}
                className="shrink-0 rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
              >
                {email?.email ? t("google.changeEmail") : t("google.addEmail")}
              </button>
            )}
          </div>
          {emailChangeSentTo && (
            <p role="status" className="mt-2 text-sm text-green-400">
              {t("google.emailChangeSent")}{" "}
              {t("google.sentTo", { email: emailChangeSentTo })}
            </p>
          )}
          {openAction === "email" && (
            <ChangeEmailForm
              onCancel={() => setOpenAction(null)}
              onSent={(pendingEmail) => {
                setEmailChangeSentTo(pendingEmail);
                setOpenAction(null);
              }}
            />
          )}
        </div>

        <div className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">
                {t("google.password")}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {state.hasPassword
                  ? t("google.hasPassword")
                  : t("google.noPassword")}
              </p>
              {!state.hasPassword && state.linked && (
                <p className="mt-1 text-xs text-slate-500">
                  {t("google.onlyMethod")}
                </p>
              )}
            </div>
            {openAction !== "password" && openAction !== "set-password" && (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setOpenAction(state.hasPassword ? "password" : "set-password");
                }}
                className="shrink-0 rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500"
              >
                {state.hasPassword
                  ? t("google.changePassword")
                  : t("google.setPassword")}
              </button>
            )}
          </div>
          {openAction === "password" && state.hasPassword && (
            <ChangePasswordForm onCancel={() => setOpenAction(null)} />
          )}
          {openAction === "set-password" && !state.hasPassword && (
            <form
              onSubmit={submitPassword}
              className="mt-3 space-y-3"
              aria-label={t("google.setPassword")}
            >
              <p className="text-sm text-slate-300">
                {t("google.setPasswordHint")}
              </p>
              <PasswordInput
                label={t("google.newPassword")}
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                name="new-password"
                id="set-password-new"
                showStrength
              />
              <PasswordInput
                label={t("google.confirmPassword")}
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                name="confirm-password"
                id="set-password-confirm"
              />
              {formError && (
                <p role="alert" className="text-sm text-red-400">
                  {formError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
                >
                  {t("google.setPassword")}
                </button>
                <button
                  type="button"
                  onClick={() => setOpenAction(null)}
                  disabled={busy}
                  className="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-white disabled:opacity-60"
                >
                  {t("common:actions.cancel")}
                </button>
              </div>
            </form>
          )}
        </div>

        {state.enabled && (
          <div className="py-3 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">
                  {t("google.google")}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {state.linked
                    ? t("google.connectedTo", {
                        email: state.email ?? t("google.aGoogleAccount"),
                      })
                    : t("google.notConnected")}
                </p>
              </div>
              {state.linked ? (
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={busy}
                  className="shrink-0 rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-60"
                >
                  {t("google.disconnect")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  disabled={busy}
                  className="shrink-0 rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500 disabled:opacity-60"
                >
                  {t("google.connect")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

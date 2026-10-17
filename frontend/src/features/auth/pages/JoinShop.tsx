/**
 * Join a shop from an emailed invite — `/#/join?invite=<token>` (LIRA-281).
 *
 * A shop admin invited this email from Settings -> Users. The link is
 * checked once; the page shows which shop and role, the invited email
 * LOCKED (the server takes it from the invite, never from this form), and
 * asks for a username — then EITHER "Join with Google" (LIRA-288) OR a
 * password and "Create my account". On success the person is sent to sign
 * in on their shop's own address.
 *
 * Join with Google: shown only while Google sign-in is on. The server checks
 * the link and the username first and returns a short join ticket, which is
 * POSTed to the www start as a form (never a URL). Google must answer with
 * the invited address; the callback then creates the account, connects
 * Google and signs the person straight in. When joining did not happen the
 * callback comes back here with `google=<reason>` (the invite still works).
 * No password is needed: a Google-only member can set one later with
 * "Forgot password".
 *
 * Web only: the desktop app has no invites (manual accounts only).
 */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  validatePasswordComplexity,
  type AcceptUserInvitationInput,
  type JoinWithGoogleResult,
  type JoinWithGoogleStartInput,
  type UserInviteCheckResult,
} from "@liratek/core";
import {
  acceptUserInvitation,
  checkUserInvitation,
  googleAuthStatus,
  startJoinWithGoogle,
} from "@/api/backendApi";
import { submitPostForm } from "@/features/auth/utils/browserNavigation";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import logger from "@/utils/logger";
import PasswordInput from "@/shared/components/PasswordInput";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";

const MIN_USERNAME = 3;

/** Why "Join with Google" did not join (the callback's `google=` value). */
const JOIN_GOOGLE_CODES: Record<JoinWithGoogleResult, true> = {
  email_mismatch: true,
  already_linked: true,
  invite_invalid: true,
  shop_not_active: true,
  username_taken: true,
  email_taken: true,
  cancelled: true,
  error: true,
};

function joinGoogleCode(code: string | null): JoinWithGoogleResult | null {
  return code && code in JOIN_GOOGLE_CODES
    ? (code as JoinWithGoogleResult)
    : null;
}

type Entry =
  | { kind: "loading" }
  | { kind: "invite"; invite: UserInviteCheckResult }
  | { kind: "invalid"; message: string };

export default function JoinShop() {
  const { t } = useTranslation("auth");
  const { t: tc } = useTranslation("common");
  const INVITE_INVALID_FALLBACK = t("join.inviteInvalid");
  const UNREACHABLE = t("shared.unreachable");
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams] = useSearchParams();
  const token = searchParams.get("invite")?.trim() || null;

  const [checked, setEntry] = useState<Entry>({ kind: "loading" });
  // No invite in the address: nothing to check (derived, not effect state).
  const entry: Entry = token
    ? checked
    : { kind: "invalid", message: INVITE_INVALID_FALLBACK };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Back from Google without joining (`google=<reason>`): shown once.
  const [error, setError] = useState(() => {
    const code = joinGoogleCode(searchParams.get("google"));
    return code ? t(`join.google.${code}`) : "";
  });
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [startingGoogle, setStartingGoogle] = useState(false);
  const [joined, setJoined] = useState<{ loginUrl: string | null } | null>(
    null,
  );

  // Check ONCE per link — the ref (not a cancelled flag) is what makes
  // StrictMode's mount -> cleanup -> mount run it a single time, so a page
  // load never spends two slots of the per-IP limiter.
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!token || checkedFor.current === token) return;
    checkedFor.current = token;

    checkUserInvitation({ token })
      .then((res) => {
        if (res.success && res.data) {
          setEntry({ kind: "invite", invite: res.data });
          return;
        }
        setEntry({
          kind: "invalid",
          message: messageFrom(res.error, INVITE_INVALID_FALLBACK),
        });
      })
      .catch((err: unknown) => {
        logger.error("Invite check failed:", err);
        setEntry({ kind: "invalid", message: messageFrom(err, UNREACHABLE) });
      });
  }, [token, INVITE_INVALID_FALLBACK, UNREACHABLE]);

  // Is "Continue with Google" switched on here? Hidden on any doubt.
  useEffect(() => {
    let cancelled = false;
    googleAuthStatus()
      .then((res) => {
        if (!cancelled)
          setGoogleEnabled(Boolean(res.success && res.data?.enabled));
      })
      .catch(() => {
        if (!cancelled) setGoogleEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const usernameReady = username.trim().length >= MIN_USERNAME;
  const canJoinWithGoogle =
    entry.kind === "invite" && usernameReady && !submitting && !startingGoogle;

  const handleJoinWithGoogle = async () => {
    if (!canJoinWithGoogle || !token) return;
    setError("");
    setStartingGoogle(true);
    try {
      // Built ONCE (rule 22): only the link and the chosen name travel.
      const payload: JoinWithGoogleStartInput = {
        token,
        username: username.trim(),
      };
      const res = await startJoinWithGoogle(payload);
      if (res.success && res.data?.url && res.data.ticket) {
        submitPostForm(res.data.url, {
          intent: "join",
          ticket: res.data.ticket,
        });
        return;
      }
      setError(messageFrom(res.error, t("join.googleStartFailed")));
    } catch (err) {
      logger.error("Join with Google start failed:", err);
      setError(messageFrom(err, UNREACHABLE));
    } finally {
      setStartingGoogle(false);
    }
  };

  const passwordProblems = password
    ? validatePasswordComplexity(password).errors
    : [];
  const canSubmit =
    entry.kind === "invite" &&
    usernameReady &&
    password.length > 0 &&
    passwordProblems.length === 0 &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !token) return;
    setError("");
    setSubmitting(true);
    try {
      // Built ONCE (rule 22); the email is never sent — it comes from the invite.
      const payload: AcceptUserInvitationInput = {
        token,
        username: username.trim(),
        password,
      };
      const res = await acceptUserInvitation(payload);
      if (res.success) {
        setJoined({ loginUrl: res.data?.loginUrl ?? null });
        return;
      }
      setError(messageFrom(res.error, t("join.couldNotCreate")));
    } catch (err) {
      logger.error("Invite accept failed:", err);
      setError(messageFrom(err, UNREACHABLE));
    } finally {
      setSubmitting(false);
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

  const signInFooter = (
    <p className={clsx("mt-4 text-center", subtleClass)}>
      {t("shared.alreadyHaveAccount")}{" "}
      <Link to="/login" className="text-orange-500 hover:text-orange-400">
        {t("shared.signIn")}
      </Link>
    </p>
  );

  if (joined) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className={clsx(headingClass, "mb-2")}>{t("join.youreIn")}</h1>
          <p className={clsx(subtleClass, "mb-6")}>{t("join.readyIntro")}</p>
          {joined.loginUrl ? (
            // A full page load: the shop's own address is another origin.
            <a
              href={joined.loginUrl}
              data-testid="join-login-url"
              className="block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors text-center"
            >
              {t("shared.goToYourShop")}
            </a>
          ) : (
            <button
              onClick={() => navigate("/login")}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors"
            >
              {t("shared.goToSignIn")}
            </button>
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
          <h1 className={clsx(headingClass, "mb-4")}>{t("join.title")}</h1>
          {errorBox(entry.message)}
          {signInFooter}
        </div>
      </div>
    );
  }

  const { invite } = entry;
  return (
    <div className={pageClass}>
      <form onSubmit={handleSubmit} className={cardClass}>
        <h1 className={clsx(headingClass, "mb-1")}>
          {t("join.joinShop", { shop: invite.shopName })}
        </h1>
        <p className={clsx(subtleClass, "mb-6")}>
          {t("join.invitedAs", { role: t(`join.roles.${invite.role}`) })}{" "}
          {googleEnabled ? t("join.chooseWithGoogle") : t("join.chooseOnly")}
        </p>

        {error && errorBox(error)}

        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="join-email">
              {t("shared.email")}
            </label>
            <input
              id="join-email"
              data-testid="join-email"
              type="email"
              value={invite.email}
              readOnly
              className={clsx(inputClass, "opacity-70 cursor-not-allowed")}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="join-username">
              {t("join.usernameRequired")}
            </label>
            <input
              id="join-username"
              data-testid="join-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
              autoComplete="username"
              autoFocus
            />
            <p className={hintClass}>
              {t("join.usernameHint", { min: MIN_USERNAME })}
            </p>
          </div>

          {googleEnabled && (
            <div>
              <button
                type="button"
                data-testid="join-google"
                onClick={handleJoinWithGoogle}
                disabled={!canJoinWithGoogle}
                className={clsx(
                  "w-full py-3 rounded-lg border font-semibold transition-colors disabled:opacity-50",
                  dark
                    ? "border-slate-600 bg-slate-900 text-white hover:bg-slate-700"
                    : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
                )}
              >
                {startingGoogle
                  ? t("join.openingGoogle")
                  : t("join.joinWithGoogle")}
              </button>
              <p className={hintClass}>
                {t("join.googleHint")} <Ltr>{invite.email}</Ltr>
                {t("join.googleHintEnd")}
              </p>
              <p className={clsx("mt-4 text-center text-xs", subtleClass)}>
                {t("join.orChoosePassword")}
              </p>
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="join-password">
              {t("join.passwordRequired")}
            </label>
            <PasswordInput
              label=""
              id="join-password"
              name="join-password"
              testId="join-password"
              value={password}
              onChange={setPassword}
              placeholder=""
              inputClassName={inputClass}
              autoComplete="new-password"
            />
            {passwordProblems.length > 0 ? (
              <p className="mt-1 text-xs text-red-500">
                {passwordProblems.join(" ")}
              </p>
            ) : (
              <p className={hintClass}>{t("join.passwordRule")}</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          data-testid="join-submit"
          disabled={!canSubmit}
          className="mt-6 w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
        >
          {submitting ? t("join.creatingAccount") : t("join.createAccount")}
        </button>

        {signInFooter}
      </form>
    </div>
  );
}

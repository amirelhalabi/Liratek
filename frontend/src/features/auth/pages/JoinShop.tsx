/**
 * Join a shop from an emailed invite — `/#/join?invite=<token>` (LIRA-281).
 *
 * A shop admin invited this email from Settings -> Users. The link is
 * checked once; the page shows which shop and role, the invited email
 * LOCKED (the server takes it from the invite, never from this form), and
 * asks for a username and password. On success the person is sent to sign
 * in on their shop's own address.
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
  type UserInviteCheckResult,
} from "@liratek/core";
import {
  acceptUserInvitation,
  checkUserInvitation,
} from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import logger from "@/utils/logger";

const INVITE_INVALID_FALLBACK =
  "This invite link is not valid. Ask the shop for a new invite.";
const UNREACHABLE = "Could not reach the server. Please try again.";
const MIN_USERNAME = 3;

const ROLE_LABEL: Record<UserInviteCheckResult["role"], string> = {
  admin: "Admin",
  staff: "Staff",
};

type Entry =
  | { kind: "loading" }
  | { kind: "invite"; invite: UserInviteCheckResult }
  | { kind: "invalid"; message: string };

export default function JoinShop() {
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
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<{ loginUrl: string | null } | null>(null);

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
  }, [token]);

  const passwordProblems = password
    ? validatePasswordComplexity(password).errors
    : [];
  const canSubmit =
    entry.kind === "invite" &&
    username.trim().length >= MIN_USERNAME &&
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
      setError(messageFrom(res.error, "Could not create your account"));
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
  const subtleClass = clsx("text-sm", dark ? "text-slate-400" : "text-gray-600");
  const hintClass = clsx("mt-1 text-xs", dark ? "text-slate-500" : "text-gray-500");
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
      Already have an account?{" "}
      <Link to="/login" className="text-orange-500 hover:text-orange-400">
        Sign in
      </Link>
    </p>
  );

  if (joined) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className={clsx(headingClass, "mb-2")}>You&apos;re in</h1>
          <p className={clsx(subtleClass, "mb-6")}>
            Your account is ready. Sign in with the username and password you
            just chose.
          </p>
          {joined.loginUrl ? (
            // A full page load: the shop's own address is another origin.
            <a
              href={joined.loginUrl}
              data-testid="join-login-url"
              className="block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors text-center"
            >
              Go to your shop
            </a>
          ) : (
            <button
              onClick={() => navigate("/login")}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors"
            >
              Go to sign in
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
          <p className={subtleClass}>Loading...</p>
        </div>
      </div>
    );
  }

  if (entry.kind === "invalid") {
    return (
      <div className={pageClass}>
        <div className={cardClass}>
          <h1 className={clsx(headingClass, "mb-4")}>Join a shop</h1>
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
        <h1 className={clsx(headingClass, "mb-1")}>Join {invite.shopName}</h1>
        <p className={clsx(subtleClass, "mb-6")}>
          You were invited as {ROLE_LABEL[invite.role]}. Choose your username
          and password.
        </p>

        {error && errorBox(error)}

        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="join-email">
              Email
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
              Username *
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
              At least {MIN_USERNAME} characters. You will use it to sign in.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="join-password">
              Password *
            </label>
            <input
              id="join-password"
              data-testid="join-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />
            {passwordProblems.length > 0 ? (
              <p className="mt-1 text-xs text-red-500">
                {passwordProblems.join(" ")}
              </p>
            ) : (
              <p className={hintClass}>
                At least 8 characters, with an uppercase letter, a lowercase
                letter, a number and a symbol.
              </p>
            )}
          </div>
        </div>

        <button
          type="submit"
          data-testid="join-submit"
          disabled={!canSubmit}
          className="mt-6 w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
        >
          {submitting ? "Creating your account..." : "Create my account"}
        </button>

        {signInFooter}
      </form>
    </div>
  );
}

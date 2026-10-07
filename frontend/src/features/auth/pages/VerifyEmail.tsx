/**
 * Confirm an account email — `/#/verify-email?token=<token>` (LIRA-279).
 *
 * The emailed link is single-use, so the page calls verify exactly ONCE
 * (StrictMode runs effects twice in development; a second call would be
 * refused and replace "confirmed" with "not valid").
 *
 * Web only: the desktop app has no account emails.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { verifyUserEmail } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import logger from "@/utils/logger";

const INVALID_FALLBACK =
  "This link is not valid. Ask for a new verification email.";
const UNREACHABLE = "Could not reach the server. Please try again.";

type State =
  | { kind: "loading" }
  | { kind: "verified" }
  | { kind: "invalid"; message: string };

export default function VerifyEmail() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() || null;

  const [result, setState] = useState<State>({ kind: "loading" });
  // No token in the address: nothing to verify (derived, not effect state).
  const state: State = token
    ? result
    : { kind: "invalid", message: INVALID_FALLBACK };

  const verifiedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!token || verifiedFor.current === token) return;
    verifiedFor.current = token;

    verifyUserEmail({ token })
      .then((res) => {
        setState(
          res.success
            ? { kind: "verified" }
            : { kind: "invalid", message: messageFrom(res.error, INVALID_FALLBACK) },
        );
      })
      .catch((err: unknown) => {
        logger.error("Email verification failed:", err);
        setState({ kind: "invalid", message: messageFrom(err, UNREACHABLE) });
      });
  }, [token]);

  const pageClass = clsx(
    "min-h-screen flex items-center justify-center p-6",
    dark ? "bg-slate-950" : "bg-gray-100",
  );
  const cardClass = clsx(
    "w-full max-w-md rounded-xl border p-6 text-center",
    dark ? "bg-slate-800 border-slate-700/50" : "bg-white border-gray-200",
  );
  const headingClass = clsx(
    "text-2xl font-bold mb-2",
    dark ? "text-white" : "text-gray-900",
  );
  const subtleClass = clsx("text-sm", dark ? "text-slate-400" : "text-gray-600");

  const signIn = (
    <p className={clsx("mt-4", subtleClass)}>
      <Link to="/login" className="text-orange-500 hover:text-orange-400">
        Go to sign in
      </Link>
    </p>
  );

  if (state.kind === "loading") {
    return (
      <div className={pageClass}>
        <div className={cardClass}>
          <p className={subtleClass}>Confirming your email...</p>
        </div>
      </div>
    );
  }

  if (state.kind === "verified") {
    return (
      <div className={pageClass}>
        <div className={cardClass}>
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className={headingClass}>Email confirmed</h1>
          <p className={subtleClass}>
            Thank you. This email address is now confirmed on your LiraTek
            account.
          </p>
          {signIn}
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <div className={cardClass}>
        <h1 className={headingClass}>Confirm your email</h1>
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500 text-left"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
        {signIn}
      </div>
    </div>
  );
}

/**
 * `/#/auth/google` — the www landing page of "Continue with Google"
 * (LIRA-280). Web only; the backend sends the browser here in two cases:
 *
 *   ?error=<code>   the sign-in did not go through. Codes, never message text
 *                   (GOOGLE_AUTH_ERRORS): no_account, cancelled, expired,
 *                   failed, not_configured.
 *   ?choose=<ticket> the Google account is connected in several shops. The
 *                   ticket is signed by the server and lists them; the page
 *                   only DISPLAYS it (decoded without verification) — the
 *                   choice goes back to the server, which verifies the
 *                   ticket and re-checks the link before handing off.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, Store } from "lucide-react";
import type { GoogleAuthErrorCode } from "@liratek/core";
import { googleChooseShop } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import { decodeJwtPayload } from "@/shared/utils/jwt";
import {
  hashQuery,
  navigateAway,
} from "@/features/auth/utils/browserNavigation";

const ERROR_TEXT: Record<GoogleAuthErrorCode, string> = {
  no_account:
    "No LiraTek account is connected to this Google account. Sign in with your username and password, then connect Google in Settings — or create a new shop.",
  signup_limit:
    "Today's limit for new shops has been reached. Please try again tomorrow. If you already have a shop, sign in instead.",
  cancelled: "Google sign-in was cancelled.",
  expired: "This Google sign-in took too long. Please try again.",
  failed: "Google sign-in did not work. Please try again.",
  not_configured: "Google sign-in is not available.",
};

const CHOOSE_FAILED =
  "This Google sign-in has expired. Please continue with Google again.";

interface ChooseShop {
  tenantId: number;
  name: string;
  slug: string;
}

function shopsFrom(ticket: string | null): ChooseShop[] {
  const claims = decodeJwtPayload<{ shops?: unknown }>(ticket);
  if (!claims || !Array.isArray(claims.shops)) return [];
  return claims.shops.filter(
    (s): s is ChooseShop =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as ChooseShop).tenantId === "number" &&
      typeof (s as ChooseShop).name === "string" &&
      typeof (s as ChooseShop).slug === "string",
  );
}

function isErrorCode(value: string | null): value is GoogleAuthErrorCode {
  return value !== null && value in ERROR_TEXT;
}

export default function GoogleAuth() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [params] = useState(() => hashQuery());
  const ticket = params.get("choose");
  const errorParam = params.get("error");
  const [shops] = useState(() => shopsFrom(ticket));
  const [busy, setBusy] = useState<number | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);

  const choose = async (shop: ChooseShop) => {
    if (!ticket) return;
    setBusy(shop.tenantId);
    setChooseError(null);
    try {
      const res = await googleChooseShop({ ticket, tenantId: shop.tenantId });
      if (res.success && res.data?.redirectUrl) {
        navigateAway(res.data.redirectUrl);
        return;
      }
      setChooseError(messageFrom(res.error, CHOOSE_FAILED));
    } catch (err) {
      setChooseError(messageFrom(err, CHOOSE_FAILED));
    } finally {
      setBusy(null);
    }
  };

  const cardClass = clsx(
    "w-full max-w-md rounded-xl border p-6",
    dark ? "bg-slate-800 border-slate-700/50" : "bg-white border-gray-200",
  );
  const headingClass = clsx(
    "text-2xl font-bold mb-4",
    dark ? "text-white" : "text-gray-900",
  );
  const subtleClass = clsx("text-sm", dark ? "text-slate-400" : "text-gray-600");

  const errorBox = (message: string) => (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500"
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );

  const footer = (
    <p className={clsx("mt-4 text-center", subtleClass)}>
      <Link to="/login" className="text-orange-500 hover:text-orange-400">
        Sign in
      </Link>
      {errorParam === "no_account" && (
        <>
          {" · "}
          <Link to="/signup" className="text-orange-500 hover:text-orange-400">
            Sign up
          </Link>
        </>
      )}
    </p>
  );

  let body: React.ReactNode;
  if (ticket && shops.length > 0) {
    body = (
      <>
        <h1 className={headingClass}>Choose your shop</h1>
        <p className={clsx(subtleClass, "mb-4")}>
          Your Google account is connected in more than one shop.
        </p>
        {chooseError && errorBox(chooseError)}
        <div className="space-y-2">
          {shops.map((shop) => (
            <button
              key={shop.tenantId}
              type="button"
              disabled={busy !== null}
              onClick={() => choose(shop)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60",
                dark
                  ? "border-slate-600 text-white hover:bg-slate-700"
                  : "border-gray-300 text-gray-900 hover:bg-gray-50",
              )}
            >
              <Store className="w-4 h-4 shrink-0 text-orange-500" />
              <span className="flex-1">{shop.name}</span>
              <span className={clsx("font-mono text-xs", subtleClass)}>
                {shop.slug}
              </span>
            </button>
          ))}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h1 className={headingClass}>Continue with Google</h1>
        {errorBox(
          isErrorCode(errorParam) ? ERROR_TEXT[errorParam] : ERROR_TEXT.failed,
        )}
      </>
    );
  }

  return (
    <div
      className={clsx(
        "min-h-screen flex items-center justify-center p-6",
        dark ? "bg-slate-950" : "bg-gray-100",
      )}
    >
      <div className={cardClass}>
        {body}
        {footer}
      </div>
    </div>
  );
}

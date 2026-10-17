/**
 * `/#/auth/google` — the www landing page of "Continue with Google"
 * (LIRA-280). Web only; the backend sends the browser here in two cases:
 *
 *   ?error=<code>   the sign-in did not go through. Codes, never message text
 *                   (GOOGLE_AUTH_ERRORS): no_account, already_connected,
 *                   signup_limit, cancelled, expired, failed, not_configured,
 *                   email_has_shop (LIRA-290: shown with a Sign in link).
 *   ?choose=<ticket> the Google account is connected in several shops (only
 *                   links made before one-account-one-shop, 2026-10-07). The
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
import { useTranslation } from "react-i18next";
import EmailHasShopNotice from "@/features/auth/components/EmailHasShopNotice";
import { googleChooseShop } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import { decodeJwtPayload } from "@/shared/utils/jwt";
import {
  hashQuery,
  navigateAway,
} from "@/features/auth/utils/browserNavigation";

/** Every code the backend may send (GOOGLE_AUTH_ERRORS). Codes, never text. */
const ERROR_CODES: Record<GoogleAuthErrorCode, true> = {
  no_account: true,
  already_connected: true,
  signup_limit: true,
  cancelled: true,
  expired: true,
  failed: true,
  not_configured: true,
  // Shown by <EmailHasShopNotice> (with its Sign in link), not errorBox.
  email_has_shop: true,
};

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
  return value !== null && value in ERROR_CODES;
}

export default function GoogleAuth() {
  const { t } = useTranslation("auth");
  const CHOOSE_FAILED = t("googleAuth.chooseFailed");
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
  const subtleClass = clsx(
    "text-sm",
    dark ? "text-slate-400" : "text-gray-600",
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

  const footer = (
    <p className={clsx("mt-4 text-center", subtleClass)}>
      <Link to="/login" className="text-orange-500 hover:text-orange-400">
        {t("shared.signIn")}
      </Link>
      {errorParam === "no_account" && (
        <>
          {" · "}
          <Link to="/signup" className="text-orange-500 hover:text-orange-400">
            {t("shared.signUp")}
          </Link>
        </>
      )}
    </p>
  );

  // email_has_shop never reaches errorBox (the branch below shows the notice).
  const errorCode: Exclude<GoogleAuthErrorCode, "email_has_shop"> =
    isErrorCode(errorParam) && errorParam !== "email_has_shop"
      ? errorParam
      : "failed";

  let body: React.ReactNode;
  if (ticket && shops.length > 0) {
    body = (
      <>
        <h1 className={headingClass}>{t("googleAuth.chooseShop")}</h1>
        <p className={clsx(subtleClass, "mb-4")}>
          {t("googleAuth.connectedMany")}
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
                "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-start transition-colors disabled:opacity-60",
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
        <h1 className={headingClass}>{t("shared.continueWithGoogle")}</h1>
        {errorParam === "email_has_shop" ? (
          <EmailHasShopNotice className="mb-4" />
        ) : (
          errorBox(t(`googleAuth.errors.${errorCode}`))
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

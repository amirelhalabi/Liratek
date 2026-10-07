/**
 * "Forgot password?" (LIRA-275) — web only, route `/forgot-password`.
 *
 * The person types the email on their account. On a shop's own address the
 * host already names the shop; on an address that names none (www, or a
 * deployment without per-shop addresses) they also type the shop address.
 * The server answers the SAME message whether or not it sent anything, so
 * this page never says whether an account exists.
 *
 * Only a VERIFIED email gets a link (server rule). The desktop app has no
 * email reset: an admin sets a new password in Settings → Users there.
 */

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, Mail } from "lucide-react";
import { PASSWORD_RESET_CODES } from "@liratek/core";
import type { ForgotPasswordInput } from "@liratek/core";
import {
  forgotPassword,
  isElectron,
  publicAuthInfo,
} from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import logger from "@/utils/logger";

const UNREACHABLE = "Could not reach the server. Please try again.";
const SHOP_REQUIRED_MESSAGE = "Enter your shop's address.";
const GENERIC_SENT =
  "If this email belongs to an account in this shop, we've sent a link.";

/** `https://CellCity.liratek.shop/` or `cellcity` -> `cellcity`. The server
 * validates the slug; this only strips what people paste around it. */
function shopSlugFromAddress(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split(/[./#?]/)[0] ?? ""
  );
}

type Setup =
  | { kind: "loading" }
  | { kind: "ready"; askShop: boolean; baseDomain: string | null }
  | { kind: "unavailable" };

export default function ForgotPassword() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const desktop = isElectron();

  const [setup, setSetup] = useState<Setup>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [shop, setShop] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  // Ask the host ONCE, even under StrictMode's double effect run. The API
  // function is a module import, so it is not a dependency (rule 25).
  const asked = useRef(false);
  useEffect(() => {
    if (desktop || asked.current) return;
    asked.current = true;
    publicAuthInfo()
      .then((res) => {
        const data = res.success ? res.data : undefined;
        if (data && data.emailInvitesEnabled === false) {
          setSetup({ kind: "unavailable" });
          return;
        }
        setSetup({
          kind: "ready",
          // The host names the shop only on a shop's own address.
          askShop: !data?.shopName,
          baseDomain: data?.baseDomain ?? null,
        });
      })
      // Cannot tell where we are: ask for the shop to be safe.
      .catch(() =>
        setSetup({ kind: "ready", askShop: true, baseDomain: null }),
      );
  }, [desktop]);

  const askShop = setup.kind === "ready" && setup.askShop;
  const slug = shopSlugFromAddress(shop);
  const canSubmit =
    email.trim().length > 0 && (!askShop || slug.length > 0) && !sending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSending(true);
    try {
      // Built ONCE (rule 22); typed by the core schema's input (rule 21).
      const payload: ForgotPasswordInput = askShop
        ? { email: email.trim(), shop: slug }
        : { email: email.trim() };
      const res = await forgotPassword(payload);
      if (res.success) {
        setSentMessage(res.data?.message ?? GENERIC_SENT);
        return;
      }
      if (res.code === PASSWORD_RESET_CODES.SHOP_REQUIRED) {
        setSetup((s) => (s.kind === "ready" ? { ...s, askShop: true } : s));
        setError(messageFrom(res.error, SHOP_REQUIRED_MESSAGE));
        return;
      }
      setError(messageFrom(res.error, "Could not send the link"));
    } catch (err) {
      logger.error("Password reset request failed:", err);
      setError(messageFrom(err, UNREACHABLE));
    } finally {
      setSending(false);
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

  const signInFooter = (
    <p className={clsx("mt-4 text-center", subtleClass)}>
      <Link to="/login" className="text-orange-500 hover:text-orange-400">
        Back to sign in
      </Link>
    </p>
  );

  if (desktop) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <h1 className={clsx(headingClass, "mb-2")}>Forgot password</h1>
          <p className={subtleClass}>
            Resetting a password by email works in the web app only. Ask your
            shop admin to set a new password in Settings → Users.
          </p>
        </div>
      </div>
    );
  }

  if (setup.kind === "loading") {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <p className={subtleClass}>Loading...</p>
        </div>
      </div>
    );
  }

  if (setup.kind === "unavailable") {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <h1 className={clsx(headingClass, "mb-2")}>Forgot password</h1>
          <p className={subtleClass}>
            Resetting a password by email is not available right now. Ask your
            shop admin to set a new password in Settings → Users.
          </p>
          {signInFooter}
        </div>
      </div>
    );
  }

  if (sentMessage) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <Mail className="w-10 h-10 text-orange-500 mx-auto mb-3" />
          <h1 className={clsx(headingClass, "mb-2")}>Check your inbox</h1>
          <p className={subtleClass}>{sentMessage}</p>
          <p className={clsx(hintClass, "mt-3")}>
            The link works once. If nothing arrives in a few minutes, check
            your spam folder, or ask your shop admin to set a new password.
          </p>
          {signInFooter}
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <form onSubmit={handleSubmit} className={cardClass}>
        <h1 className={clsx(headingClass, "mb-1")}>Forgot password</h1>
        <p className={clsx(subtleClass, "mb-6")}>
          Enter the email on your account and we&apos;ll send you a link to
          choose a new password.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="forgot-email">
              Email *
            </label>
            <input
              id="forgot-email"
              data-testid="forgot-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          {askShop && (
            <div>
              <label className={labelClass} htmlFor="forgot-shop">
                Shop address *
              </label>
              <input
                id="forgot-shop"
                data-testid="forgot-shop"
                type="text"
                autoComplete="off"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                placeholder={
                  setup.kind === "ready" && setup.baseDomain
                    ? `your-shop.${setup.baseDomain}`
                    : "your-shop"
                }
                className={inputClass}
                required
              />
              <p className={hintClass}>
                The address you sign in at, without &quot;https://&quot;.
              </p>
            </div>
          )}
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
          {sending ? "Sending..." : "Send reset link"}
        </button>
        {signInFooter}
      </form>
    </div>
  );
}

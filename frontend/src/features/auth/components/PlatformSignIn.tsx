/**
 * "Sign in to LiraTek" — the www front door (LIRA-287, owner-approved
 * 2026-10-07, modelled on Slack / Shopify / Apple identifier-first sign-in).
 *
 *   1. Remembered shops: every shop this browser signed in to (a cookie on
 *      the parent domain, written by the shop's own page) as a "Continue"
 *      row, each with "Forget this shop".
 *   2. Email -> we email a 6-digit code -> "Your shops": every shop where
 *      that email is a confirmed user. Choosing one opens that shop's own
 *      sign-in page with the username filled in; the password is still
 *      typed there (owner decision). The list only ever comes from a valid
 *      code.
 *   3. Continue with Google (the existing central flow).
 *   4. "Forgot password?", and "Create your shop" as its own button.
 *
 * No shop-address field (owner decision) and no visible platform-admin
 * sign-in: super admins use the unlinked `#/platform` route.
 *
 * Web only — the desktop app never renders this (host mode "platform" needs
 * the backend's answer on the platform host).
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, ArrowRight, Mail, Store, X } from "lucide-react";
import type { SigninShop } from "@liratek/core";
import { requestSigninCode, verifySigninCode } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import logger from "@/utils/logger";
import GoogleSignInButton from "@/features/auth/components/GoogleSignInButton";
import { shopLoginUrl } from "@/features/auth/utils/hostMode";
import {
  readCookies,
  writeCookie,
} from "@/features/auth/utils/browserNavigation";
import {
  forgetShop,
  parseRememberedShops,
  rememberedShopsCookie,
  type RememberedShop,
} from "@/features/auth/utils/rememberedShops";

const UNREACHABLE = "Could not reach the server. Please try again.";
const SENT_FALLBACK = "If this email has a LiraTek account, we've sent a code.";
const INVALID_FALLBACK =
  "That code is not right or has expired. Check it, or ask for a new one.";

type Step =
  | { kind: "email" }
  | { kind: "code"; email: string; message: string }
  | { kind: "shops"; email: string; shops: SigninShop[] };

interface PlatformSignInProps {
  baseDomain: string;
  /** Self-serve email sign-up is on: show "Create your shop". */
  canSignUp: boolean;
  dark: boolean;
}

export default function PlatformSignIn({
  baseDomain,
  canSignUp,
  dark,
}: PlatformSignInProps) {
  const [remembered, setRemembered] = useState<RememberedShop[]>(() =>
    parseRememberedShops(readCookies()),
  );
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const forget = (slug: string) => {
    const next = forgetShop(remembered, slug);
    setRemembered(next);
    writeCookie(rememberedShopsCookie(next, baseDomain));
  };

  const sendCode = async (address: string) => {
    setError("");
    setBusy(true);
    try {
      // Built ONCE (rule 22); typed by the core schema's input (rule 21).
      const res = await requestSigninCode({ email: address });
      if (res.success) {
        setCode("");
        setStep({
          kind: "code",
          email: address,
          message: res.data?.message ?? SENT_FALLBACK,
        });
        return;
      }
      setError(messageFrom(res.error, "Could not send the code"));
    } catch (err) {
      logger.error("Sign-in code request failed:", err);
      setError(messageFrom(err, UNREACHABLE));
    } finally {
      setBusy(false);
    }
  };

  const handleEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    void sendCode(address);
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== "code" || !code.trim() || busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await verifySigninCode({ email: step.email, code });
      if (res.success && res.data) {
        setStep({ kind: "shops", email: step.email, shops: res.data.shops });
        return;
      }
      setError(messageFrom(res.error, INVALID_FALLBACK));
    } catch (err) {
      logger.error("Sign-in code check failed:", err);
      setError(messageFrom(err, UNREACHABLE));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setError("");
    setCode("");
    setStep({ kind: "email" });
  };

  const subtle = dark ? "text-slate-400" : "text-gray-600";
  const rowClass = clsx(
    "flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors",
    dark
      ? "border-slate-700 bg-slate-900/60 hover:border-violet-500/60"
      : "border-gray-200 bg-white hover:border-violet-400",
  );
  const inputClass = clsx(
    "w-full rounded-lg px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500",
    dark
      ? "bg-slate-900 border-slate-600 text-white"
      : "bg-white border-gray-300 text-gray-900",
  );
  const labelClass = clsx(
    "block text-sm font-medium mb-1.5",
    dark ? "text-slate-300" : "text-gray-700",
  );
  const primaryButton = clsx(
    "w-full py-3 px-4 rounded-lg text-white font-semibold transition-all duration-200",
    busy
      ? "bg-slate-600 cursor-not-allowed opacity-70"
      : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] shadow-lg shadow-violet-600/30",
  );
  const linkButton = "text-orange-500 hover:text-orange-400 text-sm";

  const errorBox = error ? (
    <div
      role="alert"
      className={clsx(
        "p-3 rounded-lg flex items-start gap-3 text-sm border",
        dark
          ? "bg-red-500/15 border-red-500/40 text-red-300"
          : "bg-red-500/10 border-red-500/30 text-red-600",
      )}
    >
      <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
      <span>{error}</span>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      <h2
        className={clsx(
          "text-xl font-semibold text-center",
          dark ? "text-white" : "text-gray-900",
        )}
      >
        Sign in to LiraTek
      </h2>

      {step.kind === "email" && remembered.length > 0 && (
        <section aria-label="Shops on this device" className="space-y-2">
          <p className={clsx("text-xs font-medium uppercase", subtle)}>
            Your shops on this device
          </p>
          <ul className="space-y-2">
            {remembered.map((shop) => (
              <li key={shop.slug} className="flex items-center gap-2">
                <a
                  href={shopLoginUrl(shop.slug, baseDomain)}
                  className={clsx(rowClass, "flex-1 min-w-0")}
                >
                  <Store
                    size={18}
                    aria-hidden="true"
                    className="shrink-0 text-violet-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx(
                        "block truncate font-medium",
                        dark ? "text-white" : "text-gray-900",
                      )}
                    >
                      {shop.name}
                    </span>
                    <span className={clsx("block truncate text-xs", subtle)}>
                      {shop.slug}.{baseDomain}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-violet-500">
                    Continue <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => forget(shop.slug)}
                  aria-label={`Forget ${shop.name}`}
                  title="Forget this shop"
                  className={clsx(
                    "rounded-md p-2 transition-colors",
                    dark
                      ? "text-slate-500 hover:bg-slate-700 hover:text-white"
                      : "text-gray-400 hover:bg-gray-100 hover:text-gray-700",
                  )}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <p className={clsx("pt-2 text-center text-xs", subtle)}>
            Another shop? Enter your email below.
          </p>
        </section>
      )}

      {step.kind === "email" && (
        <form onSubmit={handleEmail} className="space-y-4">
          {errorBox}
          <div>
            <label htmlFor="signin-email" className={labelClass}>
              Email
            </label>
            <input
              id="signin-email"
              data-testid="signin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClass}
              required
            />
            <p className={clsx("mt-1 text-xs", subtle)}>
              We&apos;ll email you a code and show the shops you can sign in
              to.
            </p>
          </div>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? "Sending..." : "Continue with email"}
          </button>
        </form>
      )}

      {step.kind === "code" && (
        <form onSubmit={handleCode} className="space-y-4">
          <div
            className={clsx(
              "flex items-start gap-3 rounded-lg p-3 text-sm",
              dark ? "bg-slate-900/60 text-slate-300" : "bg-gray-100 text-gray-700",
            )}
          >
            <Mail size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-violet-500" />
            <span>{step.message}</span>
          </div>
          {errorBox}
          <div>
            <label htmlFor="signin-code" className={labelClass}>
              6-digit code
            </label>
            <input
              id="signin-code"
              data-testid="signin-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={clsx(inputClass, "tracking-[0.4em] font-mono text-lg")}
              autoFocus
              required
            />
            <p className={clsx("mt-1 text-xs", subtle)}>
              Sent to {step.email}. It works for 10 minutes.
            </p>
          </div>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? "Checking..." : "Show my shops"}
          </button>
          <div className="flex justify-between">
            <button type="button" onClick={startOver} className={linkButton}>
              Use a different email
            </button>
            <button
              type="button"
              onClick={() => void sendCode(step.email)}
              disabled={busy}
              className={linkButton}
            >
              Send a new code
            </button>
          </div>
        </form>
      )}

      {step.kind === "shops" && (
        <section aria-label="Your shops" className="space-y-3">
          <p className={clsx("text-sm", subtle)}>
            Your shops for {step.email}. Pick one, then enter your password.
          </p>
          {step.shops.length === 0 ? (
            <p className={clsx("text-sm", subtle)}>
              No shop can be opened with this email right now. Ask your shop
              admin.
            </p>
          ) : (
            <ul className="space-y-2">
              {step.shops.map((shop) => (
                <li key={`${shop.slug}:${shop.username}`}>
                  <a
                    href={shopLoginUrl(shop.slug, baseDomain, shop.username)}
                    className={rowClass}
                  >
                    <Store
                      size={18}
                      aria-hidden="true"
                      className="shrink-0 text-violet-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          "block truncate font-medium",
                          dark ? "text-white" : "text-gray-900",
                        )}
                      >
                        {shop.name}
                      </span>
                      <span className={clsx("block truncate text-xs", subtle)}>
                        as {shop.username}
                      </span>
                    </span>
                    <ArrowRight
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-violet-500"
                    />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={startOver} className={linkButton}>
            Use a different email
          </button>
        </section>
      )}

      {step.kind === "email" && (
        <>
          {/* Creating a shop with Google only while the emailed sign-up form
              is off; otherwise "Create your shop" below is the one door. */}
          <GoogleSignInButton offerShopCreation={!canSignUp} />
          <p className="text-center text-sm">
            <Link
              to="/forgot-password"
              className="text-orange-500 hover:text-orange-400"
            >
              Forgot password?
            </Link>
          </p>
        </>
      )}

      {canSignUp && (
        <div
          className={clsx(
            "border-t pt-5 text-center",
            dark ? "border-slate-700/50" : "border-gray-200",
          )}
        >
          <p className={clsx("mb-2 text-sm", subtle)}>New to LiraTek?</p>
          <Link
            to="/signup"
            className={clsx(
              "inline-block w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors",
              dark
                ? "border-orange-500/60 text-orange-400 hover:bg-orange-500/10"
                : "border-orange-500 text-orange-600 hover:bg-orange-50",
            )}
          >
            Create your shop
          </Link>
        </div>
      )}
    </div>
  );
}

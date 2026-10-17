/**
 * Self-service signup — create a new tenant (shop) on the web app.
 *
 * The web counterpart of the desktop first-run wizard, but deliberately ONE
 * screen rather than the wizard's several steps. `provisionTenant()` already
 * seeds a complete, working tenant — modules, currencies, drawers, settings —
 * so everything the wizard collects beyond name/slug/credentials is editable
 * in Settings afterwards. Asking for it up front would only lengthen the point
 * at which someone decides whether to bother.
 *
 * No token is issued on success by design: the new tenant is sent to its own
 * subdomain to log in, which is the only place its credentials work once
 * APP_BASE_DOMAIN is set.
 *
 * LIRA-267 — two ways in, decided on load:
 *   - INVITE   `?invite=<token>`: the emailed single-use link. Checked once;
 *              the invited email is shown locked, the shop name prefilled
 *              from the hint, and the form sends `inviteToken`. This is the
 *              ONLY way to the shop form (the shared invite code is gone).
 *   - REQUEST  no link, self-serve on: an email, an optional shop name
 *              (LIRA-278; it prefills the shop form behind the link but is
 *              never shown in the email), a hidden honeypot, and the
 *              Turnstile check only when the server has its keys. The
 *              emailed link is what opens the shop form.
 *   Otherwise: "Sign-up is not available right now".
 */

import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";
import {
  signup,
  checkSignupInvite,
  publicAuthInfo,
  requestSignupLink,
  type SignupInput,
} from "@/api/backendApi";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  EMAIL_ALREADY_HAS_SHOP,
  isLanguage,
  type RequestSignupLinkInput,
  type SignupInviteCheckResult,
} from "@liratek/core";
import EmailHasShopNotice from "@/features/auth/components/EmailHasShopNotice";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import { TurnstileWidget } from "@/features/auth/components/TurnstileWidget";
import logger from "@/utils/logger";
// [auth-D] Google sign-up (LIRA-280): its own form, for `?google=<ticket>`.
import GoogleSignupForm from "@/features/auth/components/GoogleSignupForm";
import GoogleSignInButton from "@/features/auth/components/GoogleSignInButton";
// Creating a shop lives on www, not on a shop's own address (2026-10-07).
import {
  platformSignupUrl,
  resolveHostMode,
} from "@/features/auth/utils/hostMode";
import {
  currentHostname,
  navigateAway,
} from "@/features/auth/utils/browserNavigation";
import PasswordInput from "@/shared/components/PasswordInput";
import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "@/shared/components/LanguageSwitch";

/**
 * Mirror of the server's slug rule so the field can be corrected before a
 * round trip. The SERVER remains the authority — this only saves the user a
 * rejected submit, which is why the reserved-name blocklist is deliberately
 * NOT duplicated here: one copy, server-side, cannot drift out of sync.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;

/** Upper bounds of `requestSignupLinkSchema` (formElapsedMs is an integer of
 * at most one day; shopNameHint at most 100 characters), so a slow visitor
 * or a long name is never refused by validation. */
const MAX_FORM_ELAPSED_MS = 86_400_000;
const MAX_SHOP_NAME_HINT = 100;

/** The honeypot's label is read by bots only, so it stays in English. */
const HONEYPOT_LABEL = "Website"; // i18n-exempt: bot-only honeypot label

/** What the page shows before the shop form. */
type Entry =
  | { kind: "loading" }
  | { kind: "invite"; invite: SignupInviteCheckResult }
  | { kind: "invite-invalid"; message: string }
  /** `siteKey` null: the server has no Turnstile keys, so no check. */
  | { kind: "request"; siteKey: string | null }
  | { kind: "unavailable" };

export default function Signup() {
  const { t } = useTranslation("auth");
  const { t: tc } = useTranslation("common");
  const INVITE_INVALID_FALLBACK = t("signup.inviteInvalid");
  const UNREACHABLE = t("shared.unreachable");
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite")?.trim() || null;
  // [auth-D] `?google=<ticket>`: Google already proved the email, so the
  // Google form replaces every other mode (no emailed link, no Turnstile).
  const googleTicket = searchParams.get("google")?.trim() || null;
  // LIRA-331 (FR-006, OD-1): `?lang=ar` from the Arabic landing makes it this
  // device's language at once (shown once Arabic is released, OD-4).
  const langParam = searchParams.get("lang");
  const { setLanguage } = useLanguage();
  useEffect(() => {
    if (isLanguage(langParam)) void setLanguage(langParam);
  }, [langParam, setLanguage]);

  const [entry, setEntry] = useState<Entry>({ kind: "loading" });

  // Request-a-link form (self-serve).
  const [requestEmail, setRequestEmail] = useState("");
  const [requestShopName, setRequestShopName] = useState("");
  // Honeypot (LIRA-278): hidden from people, often filled by bots.
  const [website, setWebsite] = useState("");
  // When the request form first rendered, on the browser's OWN monotonic
  // clock. Only the difference is sent (formElapsedMs), never a timestamp:
  // the server's clock is not this one (rule 27).
  const requestFormShownAt = useRef<number | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumped to REMOUNT the widget: a token the server has seen is spent.
  const [widgetKey, setWidgetKey] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  // LIRA-290: the typed email already owns a shop — shown under the email
  // field with a Sign in link, nothing emailed. Cleared when it changes.
  const [emailHasShop, setEmailHasShop] = useState(false);
  const [requestSent, setRequestSent] = useState<string | null>(null);

  const [shopName, setShopName] = useState("");
  // Tracked separately so typing the name keeps deriving the slug, while an
  // explicit slug edit is never overwritten afterwards.
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    name: string;
    slug: string;
    loginUrl: string | null;
  } | null>(null);

  // Decide the entry ONCE per link. The ref (not a `cancelled` flag) is what
  // makes StrictMode's mount -> cleanup -> mount run the check a single time:
  // the check route has its own per-IP limiter, and a dropped first result
  // plus a second request would spend two slots per page load. The API
  // functions are module imports (stable), so they are not dependencies.
  const decidedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = inviteToken ?? "";
    if (decidedFor.current === key) return;
    decidedFor.current = key;

    if (inviteToken) {
      checkSignupInvite(inviteToken)
        .then((res) => {
          if (res.success && res.data) {
            const invite = res.data;
            setEntry({ kind: "invite", invite });
            if (invite.shopNameHint) setShopName(invite.shopNameHint);
            return;
          }
          setEntry({
            kind: "invite-invalid",
            message: messageFrom(res.error, INVITE_INVALID_FALLBACK),
          });
        })
        .catch((err: unknown) => {
          logger.error("Invite check failed:", err);
          setEntry({
            kind: "invite-invalid",
            message: messageFrom(err, UNREACHABLE),
          });
        });
      return;
    }

    publicAuthInfo()
      .then((res) => {
        const data = res.success ? res.data : undefined;
        // On a shop's own address, creating a shop happens on www: leave for
        // it and stay on "loading" so no form flashes here meanwhile. An
        // invite link never reaches this branch, so it keeps working on
        // whichever address it was opened.
        const mode = resolveHostMode(data, currentHostname());
        // A Google sign-up ticket is mid-flow too: its form replaces this page
        // wherever it was opened, so it is never sent elsewhere.
        if (mode.kind === "shop" && !googleTicket) {
          navigateAway(platformSignupUrl(mode.baseDomain));
          return;
        }
        // LIRA-278: the switch alone decides; Turnstile is shown only when
        // the server hands over a site key.
        setEntry(
          data?.selfServeEnabled
            ? { kind: "request", siteKey: data.turnstileSiteKey ?? null }
            : { kind: "unavailable" },
        );
      })
      // A backend that cannot answer cannot sign anyone up either.
      .catch(() => setEntry({ kind: "unavailable" }));
    // googleTicket only gates the redirect; the ref above keeps the decision
    // to once per link either way.
  }, [inviteToken, googleTicket, INVITE_INVALID_FALLBACK, UNREACHABLE]);

  // Start the form clock when the request form is first shown — not while
  // the page is still loading the status.
  useEffect(() => {
    if (entry.kind === "request" && requestFormShownAt.current === null) {
      requestFormShownAt.current = performance.now();
    }
  }, [entry.kind]);

  const invite = entry.kind === "invite" ? entry.invite : null;
  const requestSiteKey = entry.kind === "request" ? entry.siteKey : null;

  const effectiveSlug = slugTouched ? slug : slugify(shopName);
  const slugValid = SLUG_PATTERN.test(effectiveSlug);

  const canSubmit =
    invite !== null &&
    shopName.trim().length > 0 &&
    slugValid &&
    username.trim().length >= MIN_USERNAME &&
    password.length >= MIN_PASSWORD &&
    !loading;

  const canRequest =
    requestEmail.trim().length > 0 &&
    (requestSiteKey === null || turnstileToken !== null) &&
    !requesting;

  const spendTurnstileToken = () => {
    setTurnstileToken(null);
    setWidgetKey((k) => k + 1);
  };

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRequest) return;

    setRequestError("");
    setEmailHasShop(false);
    setRequesting(true);
    try {
      const startedAt = requestFormShownAt.current ?? performance.now();
      const formElapsedMs = Math.min(
        MAX_FORM_ELAPSED_MS,
        Math.max(0, Math.round(performance.now() - startedAt)),
      );
      const shopNameHint = requestShopName.trim();
      // Built ONCE (rule 22), typed from the core schema (rule 21).
      const payload: RequestSignupLinkInput = {
        email: requestEmail.trim(),
        ...(shopNameHint ? { shopNameHint } : {}),
        website,
        formElapsedMs,
        ...(requestSiteKey !== null && turnstileToken !== null
          ? { turnstileToken }
          : {}),
      };
      const res = await requestSignupLink(payload);
      if (res.success) {
        setRequestSent(res.data?.message ?? t("signup.linkSentFallback"));
        return;
      }
      // The server spent the Turnstile token either way.
      spendTurnstileToken();
      if (res.code === EMAIL_ALREADY_HAS_SHOP) {
        setEmailHasShop(true);
        return;
      }
      setRequestError(messageFrom(res.error, t("shared.couldNotSendLink")));
    } catch (err) {
      logger.error("Sign-up link request failed:", err);
      setRequestError(messageFrom(err, UNREACHABLE));
      spendTurnstileToken();
    } finally {
      setRequesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !inviteToken) return;

    setError("");
    setLoading(true);
    try {
      // Built ONCE (rule 22).
      const payload: SignupInput = {
        name: shopName.trim(),
        slug: effectiveSlug,
        adminUsername: username.trim(),
        adminPassword: password,
        inviteToken,
      };
      const result = await signup(payload);

      if (result.success && result.data?.tenant) {
        setCreated({
          name: result.data.tenant.name,
          slug: result.data.tenant.slug,
          loginUrl: result.data.loginUrl ?? null,
        });
        return;
      }

      setError(messageFrom(result.error, t("shared.signupFailed")));
    } catch (err) {
      logger.error("Signup request failed:", err);
      setError(messageFrom(err, UNREACHABLE));
    } finally {
      setLoading(false);
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

  // [auth-D] The Google form (ticket read above). After all hooks above, so
  // the hook order never changes.
  if (googleTicket) return <GoogleSignupForm ticket={googleTicket} />;

  if (created) {
    return (
      <div className={pageClass}>
        <LanguageSwitch className="fixed top-4 end-4 z-20" />
        <div className={clsx(cardClass, "text-center")}>
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className={clsx(headingClass, "mb-2")}>
            {t("shared.isReady", { name: created.name })}
          </h1>
          <p className={clsx(subtleClass, "mb-6")}>{t("signup.readyIntro")}</p>
          <div
            className={clsx(
              "rounded-lg p-3 mb-6",
              dark ? "bg-slate-900" : "bg-gray-100",
            )}
          >
            <span className={labelClass}>{t("signup.yourShopAddress")}</span>
            {/* The real URL when subdomain tenancy is configured, the bare slug
                otherwise. Not a router <Link>: this leaves the current origin
                for the tenant's own subdomain, which is a full page load by
                definition — the SPA on this host cannot serve that realm. */}
            {created.loginUrl ? (
              <a
                href={created.loginUrl}
                data-testid="signup-login-url"
                className="font-mono text-sm text-orange-500 hover:text-orange-400 break-all"
              >
                {created.loginUrl.replace(/^https:\/\//, "")}
              </a>
            ) : (
              <p
                data-testid="signup-login-url"
                className={clsx(
                  "font-mono text-sm",
                  dark ? "text-white" : "text-gray-900",
                )}
              >
                {created.slug}
              </p>
            )}
          </div>
          {created.loginUrl ? (
            <a
              href={created.loginUrl}
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

  const errorBox = (message: string) => (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500"
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );

  // LIRA-287: "1 Email · 2 Shop details", so this page never reads as the
  // sign-in page. Step 2 is the full form opened from the emailed link.
  const stepIndicator = (current: 1 | 2) => (
    <ol
      aria-label={t("signup.stepsLabel")}
      className={clsx("mb-5 flex items-center gap-2 text-xs", subtleClass)}
    >
      {(["email", "shopDetails"] as const).map((step, i) => {
        const label =
          step === "email" ? t("shared.email") : t("signup.stepShopDetails");
        const n = (i + 1) as 1 | 2;
        const active = n === current;
        const done = n < current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {i > 0 && (
              <span aria-hidden="true" className="mx-1">
                ·
              </span>
            )}
            <span
              aria-hidden="true"
              className={clsx(
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                active || done
                  ? "bg-orange-500 text-white"
                  : dark
                    ? "bg-slate-700 text-slate-300"
                    : "bg-gray-200 text-gray-600",
              )}
            >
              {n}
            </span>
            <span
              className={clsx(
                active && "font-semibold",
                active && (dark ? "text-white" : "text-gray-900"),
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );

  const signInFooter = (
    <p className={clsx("mt-4 text-center", subtleClass)}>
      {t("shared.alreadyHaveShop")}{" "}
      <Link to="/login" className="text-orange-500 hover:text-orange-400">
        {t("shared.signIn")}
      </Link>
    </p>
  );

  if (entry.kind === "loading") {
    return (
      <div className={pageClass}>
        <LanguageSwitch className="fixed top-4 end-4 z-20" />
        <div className={clsx(cardClass, "text-center")}>
          <p className={subtleClass}>{tc("state.loading")}</p>
        </div>
      </div>
    );
  }

  if (entry.kind === "invite-invalid") {
    return (
      <div className={pageClass}>
        <LanguageSwitch className="fixed top-4 end-4 z-20" />
        <div className={cardClass}>
          <h1 className={clsx(headingClass, "mb-4")}>
            {t("shared.createYourShop")}
          </h1>
          {errorBox(entry.message)}
          {signInFooter}
        </div>
      </div>
    );
  }

  if (entry.kind === "unavailable") {
    return (
      <div className={pageClass}>
        <LanguageSwitch className="fixed top-4 end-4 z-20" />
        <div className={clsx(cardClass, "text-center")}>
          <h1 className={clsx(headingClass, "mb-2")}>
            {t("shared.createYourShop")}
          </h1>
          {/* Google sign-up is open whenever Google is configured, even with
              the emailed form off (owner decision 2026-10-07). */}
          <GoogleSignInButton
            intent="signup"
            fallback={<p className={subtleClass}>{t("signup.unavailable")}</p>}
          />
          {signInFooter}
        </div>
      </div>
    );
  }

  if (entry.kind === "request") {
    const siteKey = entry.siteKey;
    if (requestSent) {
      return (
        <div className={pageClass}>
          <LanguageSwitch className="fixed top-4 end-4 z-20" />
          <div className={clsx(cardClass, "text-center")}>
            <div className="flex justify-center">{stepIndicator(1)}</div>
            <Mail className="w-10 h-10 text-orange-500 mx-auto mb-3" />
            <h1 className={clsx(headingClass, "mb-2")}>
              {t("shared.checkInbox")}
            </h1>
            <p className={subtleClass}>{requestSent}</p>
            <p className={clsx(hintClass, "mt-3")}>{t("signup.linkOnce")}</p>
            {signInFooter}
          </div>
        </div>
      );
    }

    return (
      <div className={pageClass}>
        <LanguageSwitch className="fixed top-4 end-4 z-20" />
        <form onSubmit={handleRequest} className={cardClass}>
          {stepIndicator(1)}
          <h1 className={clsx(headingClass, "mb-1")}>
            {t("shared.createYourShop")}
          </h1>
          <p className={clsx(subtleClass, "mb-6")}>
            {t("signup.requestIntro")}
          </p>

          {/* Honeypot (LIRA-278): off-screen rather than display:none, out of
              the tab order and hidden from screen readers, with autofill off
              so a password manager never fills it for a real person. A
              filled one is answered "check your inbox" and sends nothing. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-10000px", // i18n-exempt: off-screen either way
              top: "auto",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          >
            <label htmlFor="signup-request-website">{HONEYPOT_LABEL}</label>
            <input
              id="signup-request-website"
              data-testid="signup-request-website"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {requestError && errorBox(requestError)}

          <div className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="signup-request-email">
                {t("shared.emailRequired")}
              </label>
              <input
                id="signup-request-email"
                data-testid="signup-request-email"
                type="email"
                value={requestEmail}
                onChange={(e) => {
                  setRequestEmail(e.target.value);
                  setEmailHasShop(false);
                }}
                className={inputClass}
                placeholder="you@example.com" // i18n-exempt: example address
                autoComplete="email"
                autoFocus
                aria-invalid={emailHasShop || undefined}
              />
              {emailHasShop && <EmailHasShopNotice className="mt-2" />}
            </div>

            <div>
              <label className={labelClass} htmlFor="signup-request-shop-name">
                {t("signup.shopNameOptional")}
              </label>
              <input
                id="signup-request-shop-name"
                data-testid="signup-request-shop-name"
                type="text"
                value={requestShopName}
                onChange={(e) => setRequestShopName(e.target.value)}
                className={inputClass}
                placeholder={t("signup.shopNamePlaceholder")}
                autoComplete="organization"
                maxLength={MAX_SHOP_NAME_HINT}
              />
              <p className={hintClass}>{t("signup.shopNameHelp")}</p>
            </div>

            {siteKey !== null && (
              <TurnstileWidget
                key={widgetKey}
                siteKey={siteKey}
                onSuccess={setTurnstileToken}
                onExpire={() => setTurnstileToken(null)}
              />
            )}
          </div>

          <button
            type="submit"
            data-testid="signup-request-submit"
            disabled={!canRequest}
            className="mt-6 w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
          >
            {requesting ? t("shared.sending") : t("signup.emailMeLink")}
          </button>

          <GoogleSignInButton intent="signup" />
          {signInFooter}
        </form>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <LanguageSwitch className="fixed top-4 end-4 z-20" />
      <form onSubmit={handleSubmit} className={cardClass}>
        {invite && stepIndicator(2)}
        <h1 className={clsx(headingClass, "mb-1")}>
          {t("shared.createYourShop")}
        </h1>
        <p className={clsx(subtleClass, "mb-6")}>
          {t("shared.changeLaterInSettings")}
        </p>

        {error && errorBox(error)}

        <div className="space-y-4">
          {invite && (
            <div>
              <label className={labelClass} htmlFor="signup-email">
                {t("shared.email")}
              </label>
              {/* Locked: the server takes the shop's email from the invite,
                  never from the form. */}
              <input
                id="signup-email"
                data-testid="signup-email"
                type="email"
                value={invite.email}
                readOnly
                className={clsx(inputClass, "opacity-70 cursor-not-allowed")}
              />
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="signup-shop-name">
              {t("shared.shopNameRequired")}
            </label>
            <input
              id="signup-shop-name"
              data-testid="signup-shop-name"
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className={inputClass}
              placeholder={t("signup.shopNamePlaceholder")}
              autoComplete="organization"
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="signup-slug">
              {t("shared.shopAddressRequired")}
            </label>
            <input
              id="signup-slug"
              data-testid="signup-slug"
              type="text"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className={clsx(
                inputClass,
                effectiveSlug.length > 0 &&
                  !slugValid &&
                  "border-red-500 focus:border-red-500",
              )}
              placeholder="cornertech" // i18n-exempt: example address
              autoComplete="off"
            />
            <p className={hintClass}>{t("shared.slugHint")}</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="signup-username">
              {t("shared.adminUsernameRequired")}
            </label>
            <input
              id="signup-username"
              data-testid="signup-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
              placeholder="admin" // i18n-exempt: example username
              autoComplete="username"
            />
            <p className={hintClass}>
              {t("signup.usernameHint", { min: MIN_USERNAME })}
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="signup-password">
              {t("shared.adminPasswordRequired")}
            </label>
            <PasswordInput
              label=""
              id="signup-password"
              name="signup-password"
              testId="signup-password"
              value={password}
              onChange={setPassword}
              placeholder=""
              inputClassName={inputClass}
              autoComplete="new-password"
            />
            <p className={hintClass}>
              {t("shared.minChars", { min: MIN_PASSWORD })}
            </p>
          </div>
        </div>

        <button
          type="submit"
          data-testid="signup-submit"
          disabled={!canSubmit}
          className="mt-6 w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              {t("shared.creatingShop")}
            </span>
          ) : (
            t("shared.createShop")
          )}
        </button>

        {signInFooter}
      </form>
    </div>
  );
}

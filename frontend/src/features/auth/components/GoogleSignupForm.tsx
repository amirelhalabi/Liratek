/**
 * Create a shop after "Continue with Google" (`/#/signup?google=<ticket>`,
 * LIRA-280). Web only.
 *
 * Google has already proved the email, so there is no emailed-link step: the
 * signed ticket is the proof, and its email is shown LOCKED (decoded for
 * display only; the server takes it from the verified ticket, never from the
 * form). The person still picks the shop address, an admin username AND a
 * password — owner decision 2026-10-07, so the POS login and the desktop app
 * keep working. The server enforces both (googleSignupSchema), and "one shop
 * per owner email" still applies (EmailHasShopNotice, LIRA-290).
 *
 * A separate component, not a mode inside Signup.tsx, so the invite and
 * self-serve modes that page owns stay untouched.
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  EMAIL_ALREADY_HAS_SHOP,
  validateTenantSlug,
  type GoogleSignupBodyInput,
} from "@liratek/core";
import EmailHasShopNotice from "@/features/auth/components/EmailHasShopNotice";
import { googleSignup } from "@/api/backendApi";
import { messageFrom } from "@/api/apiError";
import { useTheme } from "@/contexts/ThemeContext";
import { decodeJwtPayload } from "@/shared/utils/jwt";
import logger from "@/utils/logger";

/** Same derivation as the invite sign-up's slug field: a suggestion only;
 * the server's slug rule (validateTenantSlug) is the authority. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;
const UNREACHABLE = "Could not reach the server. Please try again.";

export default function GoogleSignupForm({ ticket }: { ticket: string }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [email] = useState(
    () => decodeJwtPayload<{ email?: unknown }>(ticket)?.email,
  );
  const [shopName, setShopName] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // LIRA-290: the Google email already owns a shop (normally caught at the
  // callback; this is a shop created in between).
  const [emailHasShop, setEmailHasShop] = useState(false);
  const [created, setCreated] = useState<{
    name: string;
    slug: string;
    loginUrl: string | null;
  } | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(shopName);
  const slugValid = validateTenantSlug(effectiveSlug).valid;
  const canSubmit =
    shopName.trim().length > 0 &&
    slugValid &&
    username.trim().length >= MIN_USERNAME &&
    password.length >= MIN_PASSWORD &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setEmailHasShop(false);
    setLoading(true);
    try {
      // Built ONCE (rule 22), typed from the core schema (rule 21).
      const payload: GoogleSignupBodyInput = {
        name: shopName.trim(),
        slug: effectiveSlug,
        adminUsername: username.trim(),
        adminPassword: password,
        googleTicket: ticket,
      };
      const result = await googleSignup(payload);
      if (result.success && result.data?.tenant) {
        setCreated({
          name: result.data.tenant.name,
          slug: result.data.tenant.slug,
          loginUrl: result.data.loginUrl ?? null,
        });
        return;
      }
      if (result.code === EMAIL_ALREADY_HAS_SHOP) {
        setEmailHasShop(true);
        return;
      }
      setError(messageFrom(result.error, "Signup failed"));
    } catch (err) {
      logger.error("Google sign-up failed:", err);
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

  if (created) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className={clsx(headingClass, "mb-2")}>{created.name} is ready</h1>
          <p className={clsx(subtleClass, "mb-6")}>
            Sign in with Google, or with the username and password you just
            chose.
          </p>
          {created.loginUrl ? (
            <a
              href={created.loginUrl}
              data-testid="google-signup-login-url"
              className="block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors text-center"
            >
              Go to your shop
            </a>
          ) : (
            <p className="font-mono text-sm">{created.slug}</p>
          )}
        </div>
      </div>
    );
  }

  const field = (
    id: string,
    label: string,
    input: React.ReactNode,
    hint?: string,
  ) => (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      {input}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  );

  return (
    <div className={pageClass}>
      <form onSubmit={handleSubmit} className={cardClass}>
        <h1 className={clsx(headingClass, "mb-1")}>Create your shop</h1>
        <p className={clsx(subtleClass, "mb-6")}>
          Google confirmed your email. Everything else can be changed later in
          Settings.
        </p>

        {emailHasShop && <EmailHasShopNotice className="mb-4" />}
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
          {field(
            "google-signup-email",
            "Email",
            <input
              id="google-signup-email"
              data-testid="google-signup-email"
              type="email"
              value={typeof email === "string" ? email : ""}
              readOnly
              className={clsx(inputClass, "opacity-70 cursor-not-allowed")}
            />,
          )}
          {field(
            "google-signup-shop-name",
            "Shop name *",
            <input
              id="google-signup-shop-name"
              data-testid="google-signup-shop-name"
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className={inputClass}
              autoComplete="organization"
              autoFocus
            />,
          )}
          {field(
            "google-signup-slug",
            "Shop address *",
            <input
              id="google-signup-slug"
              data-testid="google-signup-slug"
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
              autoComplete="off"
            />,
            "Lowercase letters, numbers and dashes. This becomes your sign-in address and cannot be changed later.",
          )}
          {field(
            "google-signup-username",
            "Admin username *",
            <input
              id="google-signup-username"
              data-testid="google-signup-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
              autoComplete="username"
            />,
            `At least ${MIN_USERNAME} characters.`,
          )}
          {field(
            "google-signup-password",
            "Admin password *",
            <input
              id="google-signup-password"
              data-testid="google-signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />,
            "You will also be able to sign in with this password, including in the desktop app.",
          )}
        </div>

        <button
          type="submit"
          data-testid="google-signup-submit"
          disabled={!canSubmit}
          className="mt-6 w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Creating your shop..." : "Create shop"}
        </button>

        <p className={clsx("mt-4 text-center", subtleClass)}>
          Already have a shop?{" "}
          <Link to="/login" className="text-orange-500 hover:text-orange-400">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

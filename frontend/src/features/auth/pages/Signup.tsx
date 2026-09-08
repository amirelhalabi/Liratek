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
 */

import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import clsx from "clsx";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { signup } from "@/api/backendApi";
import { useTheme } from "@/contexts/ThemeContext";
import logger from "@/utils/logger";

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

/**
 * Turn anything the transport can hand back into one line for the user.
 *
 * Three shapes actually reach here and only the first is obvious:
 *   - the 200-with-`success:false` envelope, whose `error` is a bare string
 *     (Zod rejections) or a `{ code, message }` object (createErrorResponse);
 *   - the `ApiError` OBJECT that `requestJson` THROWS on any non-2xx — a plain
 *     `{ status, message, details }`, NOT an `Error`, so an `instanceof Error`
 *     check misses it and the invite-code 403 would read as "could not reach
 *     the server". Its own `message` can itself be the nested object, because
 *     it is lifted straight off `data.error`;
 *   - a real `Error` from fetch when the backend is genuinely unreachable.
 */
function messageFrom(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const nested = (value as { message?: unknown }).message;
    if (typeof nested === "string" && nested.trim()) return nested;
    if (nested && typeof nested === "object") {
      return messageFrom(nested, fallback);
    }
  }
  return fallback;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;

export default function Signup() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [shopName, setShopName] = useState("");
  // Tracked separately so typing the name keeps deriving the slug, while an
  // explicit slug edit is never overwritten afterwards.
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    name: string;
    slug: string;
    loginUrl: string | null;
  } | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(shopName);
  const slugValid = SLUG_PATTERN.test(effectiveSlug);

  const canSubmit =
    shopName.trim().length > 0 &&
    slugValid &&
    username.trim().length >= MIN_USERNAME &&
    password.length >= MIN_PASSWORD &&
    inviteCode.trim().length > 0 &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setError("");
    setLoading(true);
    try {
      const result = await signup({
        name: shopName.trim(),
        slug: effectiveSlug,
        adminUsername: username.trim(),
        adminPassword: password,
        inviteCode: inviteCode.trim(),
      });

      if (result.success && result.data?.tenant) {
        setCreated({
          name: result.data.tenant.name,
          slug: result.data.tenant.slug,
          loginUrl: result.data.loginUrl ?? null,
        });
        return;
      }

      setError(messageFrom(result.error, "Signup failed"));
    } catch (err) {
      logger.error("Signup request failed:", err);
      setError(
        messageFrom(err, "Could not reach the server. Please try again."),
      );
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

  if (created) {
    return (
      <div className={pageClass}>
        <div className={clsx(cardClass, "text-center")}>
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h1 className={clsx(headingClass, "mb-2")}>
            {created.name} is ready
          </h1>
          <p className={clsx(subtleClass, "mb-6")}>
            Your shop has been created. Sign in with the admin account you just
            chose.
          </p>
          <div
            className={clsx(
              "rounded-lg p-3 mb-6",
              dark ? "bg-slate-900" : "bg-gray-100",
            )}
          >
            <span className={labelClass}>Your shop address</span>
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

  return (
    <div className={pageClass}>
      <form onSubmit={handleSubmit} className={cardClass}>
        <h1 className={clsx(headingClass, "mb-1")}>Create your shop</h1>
        <p className={clsx(subtleClass, "mb-6")}>
          Everything else can be changed later in Settings.
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
            <label className={labelClass} htmlFor="signup-shop-name">
              Shop name *
            </label>
            <input
              id="signup-shop-name"
              data-testid="signup-shop-name"
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className={inputClass}
              placeholder="Corner Tech"
              autoComplete="organization"
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="signup-slug">
              Shop address *
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
              placeholder="cornertech"
              autoComplete="off"
            />
            <p className={hintClass}>
              Lowercase letters, numbers and dashes. This becomes your sign-in
              address and cannot be changed later.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="signup-username">
              Admin username *
            </label>
            <input
              id="signup-username"
              data-testid="signup-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
              placeholder="admin"
              autoComplete="username"
            />
            <p className={hintClass}>
              At least {MIN_USERNAME} characters. It only has to be unique
              inside your own shop, so a common name is fine.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="signup-password">
              Admin password *
            </label>
            <input
              id="signup-password"
              data-testid="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
            />
            <p className={hintClass}>At least {MIN_PASSWORD} characters.</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="signup-invite-code">
              Invite code *
            </label>
            <input
              id="signup-invite-code"
              data-testid="signup-invite-code"
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
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
              Creating your shop...
            </span>
          ) : (
            "Create shop"
          )}
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

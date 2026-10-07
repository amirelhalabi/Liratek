import React, { useState, useEffect } from "react";
import logger from "@/utils/logger";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { AlertCircle } from "lucide-react";
import clsx from "clsx";
import { useShopName } from "@/hooks/useShopName";
import PasswordInput from "@/shared/components/PasswordInput";
import { TextInput } from "@liratek/ui";
import { useTheme } from "@/contexts/ThemeContext";
import { isElectron, publicAuthInfo } from "@/api/backendApi";
// Account features (SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md "Contracts"): add
// imports under YOUR anchor only (blank-line separated for clean merges).
// [auth-C] imports

// [auth-D] imports
import GoogleSignInButton from "@/features/auth/components/GoogleSignInButton";
import { useSsoHandoff } from "@/features/auth/hooks/useSsoHandoff";

// Platform front door vs a shop's own login (owner UX change 2026-10-07).
import {
  normalizeShopAddress,
  resolveHostMode,
  shopLoginUrl,
  type HostMode,
} from "@/features/auth/utils/hostMode";
import {
  currentHostname,
  navigateAway,
} from "@/features/auth/utils/browserNavigation";

/** www: the typed address names no shop. */
function shopAddressInvalid(baseDomain: string): string {
  return `Enter your shop address, for example your-shop or your-shop.${baseDomain}.`;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const shopName = useShopName();
  const { theme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Whether to offer "Sign up". Starts false so the link never flashes on a
  // desktop build or on a deployment with signup switched off — showing it
  // and then removing it is worse than showing it a moment late.
  //
  // LIRA-267: shown exactly when a visitor can email themselves a sign-up
  // link (selfServeEnabled). Invited shops arrive through their emailed link
  // and never need this one; the shared invite code is gone.
  const [canSignUp, setCanSignUp] = useState(false);

  // The shop's name as resolved from the SUBDOMAIN, which is knowable before
  // anyone logs in. `useShopName()` above reads it from tenant-scoped settings
  // and is therefore always empty here on the web -- that is why every shop's
  // login page said "LiraTek" even though the address bar already said which
  // shop it was.
  const [hostShopName, setHostShopName] = useState<string | null>(null);

  // Which page this host gets: the platform front door (www), a shop's own
  // login, or the combined page (desktop, localhost, previews, no answer).
  // null while the backend is being asked: the combined form shows, but
  // nothing that creates a shop does, so it never flashes on a shop address.
  const [hostMode, setHostMode] = useState<HostMode | null>(() =>
    isElectron() ? { kind: "combined" } : null,
  );
  // www only: the shop address typed, and whether a platform admin asked for
  // the username form (super admins sign in on www).
  const [shopAddress, setShopAddress] = useState("");
  const [adminSignIn, setAdminSignIn] = useState(false);

  useEffect(() => {
    if (isElectron()) return;
    let cancelled = false;
    publicAuthInfo()
      .then((r) => {
        if (cancelled) return;
        const data = r.success ? r.data : undefined;
        setHostMode(resolveHostMode(data, currentHostname()));
        if (!data) return;
        setCanSignUp(Boolean(data.selfServeEnabled));
        if (data.shopName) setHostShopName(data.shopName);
      })
      // A backend that cannot answer is a backend that cannot sign anyone up
      // either, so staying silent is the correct outcome, not a failure.
      .catch(() => {
        if (!cancelled) setHostMode({ kind: "combined" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // [auth-D] the ?sso=<token> hand-off exchange (web only) goes here
  // After "Continue with Google" on www (LIRA-280): exchanged once, then the
  // app restarts at home signed in. A refusal shows in the form's error box.
  const sso = useSsoHandoff();

  const platformBase =
    hostMode?.kind === "platform" ? hostMode.baseDomain : null;
  const showShopForm = platformBase !== null && !adminSignIn;

  // www: "Continue" goes to the shop's own login page. A full navigation —
  // it is another origin. Not checked for existence first (there is no public
  // lookup); an unknown address refuses every sign-in on its own.
  const handleShopContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (platformBase === null) return;
    const slug = normalizeShopAddress(shopAddress);
    if (!slug) {
      setError(shopAddressInvalid(platformBase));
      return;
    }
    setError("");
    navigateAway(shopLoginUrl(slug, platformBase));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login(username, password, rememberMe);
      if (result.success) {
        // Super admins (web-only, plan §5) land in the control plane, never
        // the POS home — ProtectedRoute would redirect them there anyway,
        // but navigating directly avoids the extra bounce.
        navigate(result.role === "super_admin" ? "/admin/tenants" : "/");
      } else {
        setError(result.error || "Login failed");
      }
    } catch (err) {
      setError("An unexpected error occurred");
      logger.error("Login failed", { error: err });
    } finally {
      setLoading(false);
    }
  };

  // [auth-D] hand-off progress / refusal, plus this page's own errors.
  // Rendered INSIDE whichever form is showing: the page (and its e2e) reads
  // a refused sign-in from the form itself.
  const messages = (
    <>
      {sso.exchanging && (
        <p className="text-sm text-slate-400" role="status">
          Signing you in with Google...
        </p>
      )}
      {(error || sso.error) && (
        <div
          role="alert"
          className={clsx(
            "p-4 rounded-lg flex items-start gap-3 text-sm animate-in fade-in border",
            theme === "dark"
              ? "bg-red-500/15 border-red-500/40 text-red-300"
              : "bg-red-500/10 border-red-500/30 text-red-600",
          )}
        >
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <span>{error || sso.error}</span>
        </div>
      )}
    </>
  );

  return (
    <div
      className={clsx(
        "min-h-screen flex items-center justify-center p-4 relative overflow-hidden transition-colors",
        theme === "dark"
          ? "bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950"
          : "bg-gradient-to-br from-gray-50 via-gray-50 to-gray-100",
      )}
    >
      {/* Subtle background pattern */}
      <div
        className={clsx(
          "absolute inset-0",
          theme === "dark" ? "opacity-10" : "opacity-5",
        )}
      >
        <div
          className={clsx(
            "absolute top-0 left-1/4 w-72 h-72 rounded-full mix-blend-multiply filter blur-3xl",
            theme === "dark" ? "bg-violet-600" : "bg-violet-400",
          )}
        ></div>
        <div
          className={clsx(
            "absolute -bottom-8 right-1/4 w-72 h-72 rounded-full mix-blend-multiply filter blur-3xl",
            theme === "dark" ? "bg-indigo-600" : "bg-indigo-400",
          )}
        ></div>
      </div>

      <div
        className={clsx(
          "relative rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-colors backdrop-blur-xl",
          theme === "dark"
            ? "bg-slate-800/80 border border-slate-700/50"
            : "bg-white/80 border border-gray-200/50",
        )}
      >
        {/* Header */}
        <div
          className={clsx(
            "bg-gradient-to-r p-10 text-center relative overflow-hidden",
            theme === "dark"
              ? "from-violet-600 to-indigo-600"
              : "from-violet-500 to-indigo-500",
          )}
        >
          {/* Decorative gradient overlay */}
          <div className="absolute inset-0 opacity-20 bg-gradient-to-b from-white to-transparent"></div>

          <div className="relative z-10">
            {/* The PRODUCT name until a shop has named itself. This header is
                what showed a stranger name on every login page: the shop name
                came from a pre-auth settings read that fails on the web (no
                tenant context without a JWT), and the fallback was a literal
                customer name. Branding the product here is honest -- before
                login there is no tenant to speak for. */}
            <h1 className="text-4xl font-bold text-white whitespace-nowrap mb-2">
              {shopName || hostShopName || "LiraTek"}
            </h1>
            <p className="font-medium text-white">Management System</p>
          </div>
        </div>

        {/* Form */}
        <div className="p-8 relative z-10">
          {showShopForm ? (
            <form onSubmit={handleShopContinue} className="space-y-5">
              {messages}
              <h2
                className={clsx(
                  "text-xl font-semibold text-center",
                  theme === "dark" ? "text-white" : "text-gray-900",
                )}
              >
                Sign in to your shop
              </h2>
              <div>
                <label
                  htmlFor="login-shop-address"
                  className={clsx(
                    "block text-sm font-medium mb-1.5",
                    theme === "dark" ? "text-slate-300" : "text-gray-700",
                  )}
                >
                  Shop address
                </label>
                <input
                  id="login-shop-address"
                  data-testid="login-shop-address"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={shopAddress}
                  onChange={(e) => setShopAddress(e.target.value)}
                  placeholder={`your-shop.${platformBase}`}
                  className={clsx(
                    "w-full rounded-lg px-3 py-2.5 text-sm border focus:outline-none focus:border-violet-500",
                    theme === "dark"
                      ? "bg-slate-900 border-slate-600 text-white"
                      : "bg-white border-gray-300 text-gray-900",
                  )}
                  required
                />
                <p
                  className={clsx(
                    "mt-1 text-xs",
                    theme === "dark" ? "text-slate-500" : "text-gray-500",
                  )}
                >
                  The address your shop signs in at, for example your-shop.
                  {platformBase}
                </p>
              </div>
              <button
                type="submit"
                className="w-full py-3 px-4 rounded-lg text-white font-semibold transition-all duration-200 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] shadow-lg shadow-violet-600/30"
              >
                Continue
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {messages}
              <div className="pt-2">
                <TextInput
                  value={username}
                  onChange={setUsername}
                  label="Username"
                  placeholder="Enter username"
                  icon="user"
                  required
                />
              </div>

              <div>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  label="Password"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex items-center pt-2">
                <div className="relative flex items-center">
                  <input
                    id="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="peer w-5 h-5 bg-slate-700 border-2 border-slate-600 rounded cursor-pointer accent-violet-500 hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-800 transition-colors"
                  />
                </div>
                <label
                  htmlFor="remember-me"
                  className="ml-3 text-sm text-slate-300 cursor-pointer select-none"
                >
                  Keep me signed in on this device
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={clsx(
                  "w-full py-3 px-4 rounded-lg text-white font-semibold transition-all duration-200 mt-6",
                  loading
                    ? "bg-slate-600 cursor-not-allowed opacity-70"
                    : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:scale-[0.98] shadow-lg shadow-violet-600/30 hover:shadow-lg hover:shadow-violet-600/50",
                )}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Signing in...
                  </span>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>
          )}

          {/* [auth-C] "Forgot password?" link (web only) */}
          {/* The desktop app has no email reset: an admin sets a new
              password in Settings → Users there. */}
          {!isElectron() && (
            <p className="mt-4 text-center text-sm">
              <Link
                to="/forgot-password"
                className="text-orange-500 hover:text-orange-400"
              >
                Forgot password?
              </Link>
            </p>
          )}

          {/* [auth-D] "Continue with Google" button (web only, when enabled) */}
          {/* "Create a shop with Google": always on the combined page, never
              on a shop's own address. On www only while email sign-up is off;
              otherwise "Create your shop" below is the one door (the sign-up
              page offers Google too). */}
          <GoogleSignInButton
            offerShopCreation={
              hostMode?.kind === "combined" ||
              (platformBase !== null && !canSignUp)
            }
          />

          {/* Web only, and only when a visitor can sign up on their own:
              self-serve email sign-up (LIRA-267). The desktop build
              provisions its single tenant through the first-run setup
              wizard, so a sign-up link there would lead to an endpoint IPC
              never serves. On www it reads "Create your shop"; never on a
              shop's own address (creating a shop is www's job). */}
          {canSignUp && platformBase !== null && (
            <p
              className={clsx(
                "mt-6 text-center text-sm",
                theme === "dark" ? "text-slate-400" : "text-gray-600",
              )}
            >
              New to LiraTek?{" "}
              <Link
                to="/signup"
                className="text-orange-500 hover:text-orange-400"
              >
                Create your shop
              </Link>
            </p>
          )}

          {/* www: super admins sign in here with a username (they belong to
              no shop). Tucked away so shop staff are not invited to type a
              username that means nothing on this address. */}
          {platformBase !== null && (
            <p className="mt-4 text-center text-xs">
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setAdminSignIn((v) => !v);
                }}
                className={clsx(
                  "underline-offset-2 hover:underline",
                  theme === "dark" ? "text-slate-500" : "text-gray-500",
                )}
              >
                {adminSignIn
                  ? "Sign in to your shop instead"
                  : "Platform admin sign in"}
              </button>
            </p>
          )}

          {canSignUp && hostMode?.kind === "combined" && (
            <p
              className={clsx(
                "mt-6 text-center text-sm",
                theme === "dark" ? "text-slate-400" : "text-gray-600",
              )}
            >
              New here?{" "}
              <Link
                to="/signup"
                className="text-orange-500 hover:text-orange-400"
              >
                Sign up
              </Link>
            </p>
          )}

          <div
            className={clsx(
              "mt-8 pt-6 text-center text-xs",
              theme === "dark"
                ? "border-t border-slate-700/50 text-slate-400"
                : "border-t border-gray-300/50 text-gray-600",
            )}
          >
            <p>
              <span
                className={
                  theme === "dark" ? "text-slate-500" : "text-gray-500"
                }
              >
                Version
              </span>{" "}
              {__APP_VERSION__}
              {/* Only when the shop has actually named itself. Before login
                  the settings read is unauthenticated and fails, so this is
                  empty on the web -- and "Licensed to" followed by a blank, or
                  worse a placeholder, is how a stranger's name ended up on
                  every login page. The separator belongs to this part: alone
                  it read "Version 1.33.0 •". */}
              {(shopName || hostShopName) && (
                <>
                  {" "}
                  <span
                    className={clsx(
                      "mx-2",
                      theme === "dark" ? "text-slate-600" : "text-gray-400",
                    )}
                  >
                    •
                  </span>{" "}
                  <span
                    className={
                      theme === "dark" ? "text-slate-300" : "text-gray-700"
                    }
                  >
                    Licensed to
                  </span>{" "}
                  <span
                    className={
                      theme === "dark"
                        ? "text-slate-300"
                        : "text-gray-800 font-medium"
                    }
                  >
                    {shopName || hostShopName}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

import { createContext, useContext, useState, useEffect } from "react";
import logger from "@/utils/logger";
import type { ReactNode } from "react";
import { useApi } from "@liratek/ui";
import {
  getImpersonationInfo,
  type ImpersonationInfo,
} from "@/features/admin/utils/impersonation";
import { UNAUTHORIZED_EVENT, getToken } from "@/api/httpClient";

interface User {
  id: number;
  username: string;
  /** Includes the web-only "super_admin" platform realm (plan §3), in
   * addition to the existing "admin" | "staff". Kept as `string` (not a
   * literal union) since the desktop IPC surface still returns a plain
   * string and this interface must accept both without a cast. */
  role: string;
  /** Web-mode only — decoded client-side from the JWT. `null` only for
   * `super_admin`; `undefined` when there's nothing to decode (Electron). */
  tenantId?: number | null;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isSetupRequired: boolean;
  login: (
    username: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<{ success: boolean; error?: string; role?: string }>;
  logout: () => Promise<void>;
  needsOpening: boolean;
  clearOpeningFlag: () => void;
  clearSetupRequired: () => void;
  /** True in a tab that booted from a "Connect as admin" handoff (web-only —
   * see features/admin). Read fresh from sessionStorage on every render, so
   * it's correct immediately after bootstrap and after Disconnect without
   * any extra state plumbing. */
  isImpersonating: boolean;
  /** Non-null exactly when `isImpersonating` is true. */
  impersonationInfo: ImpersonationInfo | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSetupRequired, setIsSetupRequired] = useState(false);
  const [needsOpening, setNeedsOpening] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Read fresh every render (sessionStorage, not React state) — correct
  // immediately after the main.tsx bootstrap and after Disconnect without
  // needing to plumb an extra effect/listener for it.
  const impersonationInfo = getImpersonationInfo();
  const isImpersonating = impersonationInfo.active;

  // Restore session from encrypted storage on mount
  useEffect(() => {
    let isMounted = true; // Guard against double calls in StrictMode

    async function loadUser() {
      try {
        // Check if setup wizard needs to run (Electron only)
        if (window.api) {
          try {
            const setupCheck = await window.api.setup.isRequired();
            if (setupCheck?.isRequired) {
              setIsSetupRequired(true);
              setIsLoading(false);
              return;
            }
          } catch {
            // Not available (web mode) — skip
          }
        }

        // Try to restore from encrypted session first
        if (window.api) {
          // Try to get stored session token from localStorage
          const storedToken = localStorage.getItem("sessionToken");

          const result = await window.api.auth.restoreSession(
            storedToken || undefined,
          );

          // Only update state if component is still mounted (prevents React.StrictMode double-call issues)
          if (!isMounted) {
            return;
          }

          if (result.success && result.user) {
            setUser(result.user);
            if (result.sessionToken) {
              setSessionToken(result.sessionToken);
              localStorage.setItem("sessionToken", result.sessionToken);
            }
          }
        } else if (getToken()) {
          // Web mode: try backend session.
          //
          // Gated on actually HAVING a token. With none there is nothing to
          // restore and the call can only answer 401 "No token provided" --
          // which is what put a red /api/auth/me in the network tab of every
          // logged-out visitor to the login page, looking like a fault when
          // the app was working exactly as intended.
          try {
            const result = await api.me();
            if (result.success && result.user) {
              setUser(result.user);
            }
          } catch {
            // ignore
          }
        }
      } catch (error) {
        logger.error("Failed to restore session:", error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadUser();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, []);

  // WEB counterpart to the desktop "session:expired" handler below: the server
  // rejected a credential we actually sent, so this session is over.
  //
  // Without it the app kept `user` set after the token stopped being accepted,
  // so it rendered a full dashboard while every request 401'd and the login
  // screen never appeared. httpClient has already discarded the token by the
  // time this fires; all that is left is to make the UI agree.
  //
  // No server call: the server is precisely what just refused us, and asking it
  // to log us out would 401 again.
  useEffect(() => {
    const onUnauthorized = () => {
      logger.warn("Session rejected by the server — signing out locally");
      setUser(null);
      setSessionToken(null);
      setNeedsOpening(false);
      localStorage.removeItem("sessionToken");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  // The main process purges idle in-memory IPC sessions (30 min) and emits
  // "session:expired". Try a silent restore from the stored token — valid
  // rememberMe sessions recover invisibly; otherwise fall back to login.
  useEffect(() => {
    if (!window.api?.auth?.onSessionExpired) return;

    const unsubscribe = window.api.auth.onSessionExpired(async () => {
      try {
        const storedToken = localStorage.getItem("sessionToken");
        const result = await window.api.auth.restoreSession(
          storedToken || undefined,
        );

        if (result.success && result.user) {
          setUser(result.user);
          if (result.sessionToken) {
            setSessionToken(result.sessionToken);
            localStorage.setItem("sessionToken", result.sessionToken);
          }
          return;
        }
      } catch (error) {
        logger.error("Silent session restore failed:", error);
      }

      // No valid session left — clear auth state so ProtectedRoute redirects
      setUser(null);
      setSessionToken(null);
      setNeedsOpening(false);
      localStorage.removeItem("sessionToken");
    });

    return unsubscribe;
  }, []);

  const login = async (
    username: string,
    password: string,
    rememberMe: boolean = false,
  ) => {
    try {
      const result = await api.login(username, password, rememberMe);

      if (result.success && result.user) {
        setUser(result.user);
        // Store session token
        if (result.sessionToken) {
          setSessionToken(result.sessionToken);
          localStorage.setItem("sessionToken", result.sessionToken);
        }

        // Check if opening balance needs to be set for today
        try {
          const hasOpening = await api.hasOpeningBalanceToday();
          setNeedsOpening(!hasOpening);
        } catch (error) {
          logger.error("Failed to check opening balance:", error);
          // Don't block login on this error
        }

        return { success: true, role: result.user.role };
      }
      return { success: false, error: result.error || "Login failed" };
    } catch (error) {
      logger.error("Login error:", error);
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const logout = async () => {
    if (user) {
      // Impersonation sessions must always attempt the backend logout call —
      // that's what revokes the impersonation DB session server-side. The
      // actual "don't clobber the super admin's own tab" guarantee lives in
      // backendApi.logout() (it only ever clears whichever storage was
      // active in THIS tab); this condition just makes sure we don't skip
      // that call for an impersonation session with no `sessionToken` state.
      if (sessionToken || isImpersonating) {
        // A FAILED server logout must never block the local one.
        //
        // `backendApi.logout()` clears the stored token in a `finally`, but the
        // rejection still propagates — and without this catch it skipped every
        // line below, leaving `user` set while the token was already gone. The
        // app then believed it was signed in and kept firing requests with no
        // credentials, so every endpoint answered 401 and the login screen was
        // never shown. Clicking "log out" appeared to do nothing.
        //
        // Seen for real after the Reset Data feature wiped `sessions`: the
        // token's session row no longer existed, so /api/auth/logout answered
        // 401 — the exact case where logging out locally matters MOST.
        try {
          await api.logout();
        } catch (error) {
          logger.warn("Server logout failed; clearing the session locally", {
            error,
          });
        }
      }
    }
    setUser(null);
    setSessionToken(null);
    setNeedsOpening(false);
    localStorage.removeItem("sessionToken");
  };

  const clearOpeningFlag = () => {
    setNeedsOpening(false);
  };

  const clearSetupRequired = () => {
    setIsSetupRequired(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        isSetupRequired,
        login,
        logout,
        needsOpening,
        clearOpeningFlag,
        clearSetupRequired,
        isImpersonating,
        impersonationInfo: isImpersonating ? impersonationInfo : null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Auth state for consumers that merely DECORATE a screen and must not decide
 * whether it renders at all.
 *
 * `useAuth` throws without a provider, which is right for anything gating
 * access — a silent `undefined` there would fail open. It is wrong for a
 * component that only wants to know "is anyone signed in, so should I bother
 * fetching the shop name": there, no provider simply means nobody is signed
 * in. Making that a thrown error let one display concern take down the whole
 * subtree, and did: adding a `useAuth` call inside `useShopInfo` crashed every
 * component that shows a shop name in any test that had no AuthProvider.
 *
 * Returns undefined outside a provider. Callers treat that as logged out.
 */
export function useOptionalAuth(): AuthContextType | undefined {
  return useContext(AuthContext);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

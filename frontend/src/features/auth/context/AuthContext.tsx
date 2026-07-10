import { createContext, useContext, useState, useEffect } from "react";
import logger from "@/utils/logger";
import type { ReactNode } from "react";
import { useApi } from "@liratek/ui";
import {
  getImpersonationInfo,
  type ImpersonationInfo,
} from "@/features/admin/utils/impersonation";

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
        } else {
          // Web mode: try backend session
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
        await api.logout();
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

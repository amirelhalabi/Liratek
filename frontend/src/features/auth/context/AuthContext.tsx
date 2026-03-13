import { createContext, useContext, useState, useEffect } from "react";
import logger from "@/utils/logger";
import type { ReactNode } from "react";
import { useApi } from "@liratek/ui";
import { getToken, requestJson, type ApiError } from "@/api/httpClient";

function isJwtExpired(token: string | null): boolean {
  if (!token) return true;

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp;
    if (!exp) return false; // No expiration claim
    return Date.now() >= exp * 1000;
  } catch (_e) {
    // Invalid token format
    return true;
  }
}

interface User {
  id: number;
  username: string;
  role: string;
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
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  needsOpening: boolean;
  clearOpeningFlag: () => void;
  clearSetupRequired: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSetupRequired, setIsSetupRequired] = useState(false);
  const [needsOpening, setNeedsOpening] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

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
          // Check if JWT is expired first
          const jwtToken = getToken();
          if (isJwtExpired(jwtToken)) {
            // JWT is expired, clear tokens and skip session restoration
            localStorage.removeItem("liratek.jwt");
            localStorage.removeItem("sessionToken");
          } else {
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
              // Validate subscription before setting user
              try {
                await requestJson("/api/subscription/validate-self", {
                  method: "POST",
                  body: { forceRefresh: false },
                });

                // Subscription valid - proceed with session restoration
                setUser(result.user);
                if (result.sessionToken) {
                  setSessionToken(result.sessionToken);
                  localStorage.setItem("sessionToken", result.sessionToken);
                }
              } catch (error) {
                const apiError = error as ApiError;
                if (apiError.status === 403) {
                  // Subscription invalid - don't restore session
                  logger.warn(
                    "Session restoration blocked - subscription invalid",
                  );
                  localStorage.removeItem("liratek.jwt");
                  localStorage.removeItem("sessionToken");
                  return;
                }

                if (!navigator.onLine) {
                  // Network error while offline - allow offline access
                  logger.warn(
                    "Subscription validation failed while offline - allowing offline access",
                  );
                  setUser(result.user);
                  if (result.sessionToken) {
                    setSessionToken(result.sessionToken);
                    localStorage.setItem("sessionToken", result.sessionToken);
                  }
                } else {
                  // Online but validation failed (401, 500, etc.) - don't restore session
                  logger.warn(
                    "Session restoration blocked - subscription validation error",
                  );
                  localStorage.removeItem("liratek.jwt");
                  localStorage.removeItem("sessionToken");
                  return;
                }
              }
            }
          }
        } else {
          // Web mode: try backend session
          try {
            const result = await api.me();
            if (result.success && result.user) {
              // Validate subscription before setting user
              try {
                await requestJson("/api/subscription/validate-self", {
                  method: "POST",
                  body: { forceRefresh: false },
                });

                // Subscription valid - proceed with session restoration
                setUser(result.user);
              } catch (error) {
                const apiError = error as ApiError;
                if (apiError.status === 403) {
                  // Subscription invalid - don't restore session
                  logger.warn(
                    "Session restoration blocked - subscription invalid",
                  );
                  localStorage.removeItem("liratek.jwt");
                  return;
                }

                if (!navigator.onLine) {
                  // Network error while offline - allow offline access
                  logger.warn(
                    "Subscription validation failed while offline - allowing offline access",
                  );
                  setUser(result.user);
                } else {
                  // Online but validation failed (401, 500, etc.) - don't restore session
                  logger.warn(
                    "Session restoration blocked - subscription validation error",
                  );
                  localStorage.removeItem("liratek.jwt");
                  return;
                }
              }
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

    // Check JWT expiration periodically
    const checkJwtExpiration = () => {
      const jwtToken = getToken();
      if (isJwtExpired(jwtToken)) {
        // JWT is expired, clear tokens and log out
        localStorage.removeItem("liratek.jwt");
        localStorage.removeItem("sessionToken");
        if (isMounted) {
          setUser(null);
          setSessionToken(null);
        }
      }
    };

    // Check every minute
    const intervalId = setInterval(checkJwtExpiration, 60000);

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
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

        return { success: true };
      }
      return { success: false, error: result.error || "Login failed" };
    } catch (error) {
      logger.error("Login error:", error);
      return { success: false, error: "An unexpected error occurred" };
    }
  };

  const logout = async () => {
    if (user) {
      if (sessionToken) {
        await api.logout();
      }
    }
    setUser(null);
    setSessionToken(null);
    setNeedsOpening(false);
    localStorage.removeItem("sessionToken");
    localStorage.removeItem("liratek.jwt");
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

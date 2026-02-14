import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { appEvents } from "@liratek/ui";
import * as api from "../../../api/backendApi";

interface User {
  id: number;
  username: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    username: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  needsOpening: boolean;
  clearOpeningFlag: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsOpening, setNeedsOpening] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Restore session from encrypted storage on mount
  useEffect(() => {
    let isMounted = true; // Guard against double calls in StrictMode

    async function loadUser() {
      try {
        console.log("🔍 [AUTH-CONTEXT] Starting session restoration on mount");

        // Try to restore from encrypted session first
        if (window.api) {
          // Try to get stored session token from localStorage
          const storedToken = localStorage.getItem("sessionToken");
          console.log(
            "🔍 [AUTH-CONTEXT] Stored token in localStorage:",
            storedToken ? `${storedToken.substring(0, 10)}...` : "none",
          );

          const result = await window.api.restoreSession(
            storedToken || undefined,
          );
          console.log("🔍 [AUTH-CONTEXT] Restore session result:", {
            success: result.success,
            hasUser: !!result.user,
            hasToken: !!result.sessionToken,
          });

          // Only update state if component is still mounted (prevents React.StrictMode double-call issues)
          if (!isMounted) {
            console.log(
              "⚠️ [AUTH-CONTEXT] Component unmounted, skipping state update",
            );
            return;
          }

          if (result.success && result.user) {
            setUser(result.user);
            if (result.sessionToken) {
              setSessionToken(result.sessionToken);
              localStorage.setItem("sessionToken", result.sessionToken);
              console.log(
                "✅ [AUTH-CONTEXT] Session restored from database, token saved",
              );
            } else {
              console.warn(
                "⚠️ [AUTH-CONTEXT] Session restored but no token returned",
              );
            }
            console.log(
              "✅ [AUTH-CONTEXT] User logged in:",
              result.user.username,
            );
          } else {
            console.log(
              "❌ [AUTH-CONTEXT] Session restoration failed:",
              result.error || "unknown",
            );
          }
        } else {
          // Web mode: try backend session
          console.warn("Running in web mode - using backend API");
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
        console.error("Failed to restore session:", error);
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

  const login = async (
    username: string,
    password: string,
    rememberMe: boolean = false,
  ) => {
    try {
      const result = await api.login(username, password, rememberMe);
      console.log("🔍 [AUTH-CONTEXT] Login result:", {
        success: result.success,
        hasUser: !!result.user,
        hasToken: !!result.sessionToken,
        rememberMe,
      });

      if (result.success && result.user) {
        setUser(result.user);
        // Store session token
        if (result.sessionToken) {
          setSessionToken(result.sessionToken);
          localStorage.setItem("sessionToken", result.sessionToken);
          console.log(
            "✅ [AUTH-CONTEXT] Login successful, session token saved to localStorage:",
            result.sessionToken.substring(0, 10) + "...",
          );
        } else {
          console.warn(
            "⚠️ [AUTH-CONTEXT] Login successful but no session token returned",
          );
        }

        // Check if opening balance needs to be set for today
        try {
          const hasOpening = await api.hasOpeningBalanceToday();
          setNeedsOpening(!hasOpening);
        } catch (error) {
          console.error("Failed to check opening balance:", error);
          // Don't block login on this error
        }

        appEvents.emit("openOpeningModal");
        return { success: true };
      }
      return { success: false, error: result.error || "Login failed" };
    } catch (error) {
      console.error("Login error:", error);
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
  };

  const clearOpeningFlag = () => {
    setNeedsOpening(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        needsOpening,
        clearOpeningFlag,
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

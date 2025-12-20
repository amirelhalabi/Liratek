
import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { appEvents } from "../../../shared/utils/appEvents";

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

  // Restore session from encrypted storage on mount
  useEffect(() => {
    async function loadUser() {
      try {
        // Try to restore from encrypted session first
        if (window.api) {
          const result = await window.api.restoreSession();
          if (result.success && result.user) {
            setUser(result.user);
            console.log("[AUTH] Session restored from encrypted storage");
          }
        } else {
          // Mock session for web environment
          console.warn("Running in web mode - mocking session");
          setUser({ id: 1, username: "dev", role: "admin" });
        }
      } catch (error) {
        console.error("Failed to restore session:", error);
      }
      setIsLoading(false);
    }
    loadUser();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      // Mock login for web environment
      if (!window.api) {
        console.warn("Running in web mode - using mock login");
        const mockUser = { id: 1, username, role: "admin" };
        setUser(mockUser);
        setNeedsOpening(false);
        return { success: true };
      }

      const result = await window.api.login(username, password);
      if (result.success && result.user) {
        setUser(result.user);
        // Session token is now stored encrypted on the backend

        // Check if opening balance needs to be set for today
        try {
          const hasOpening = await window.api.closing.hasOpeningBalanceToday();
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
      if (window.api) {
        await window.api.logout(user.id);
      }
    }
    setUser(null);
    setNeedsOpening(false);
    // Encrypted session is cleared on the backend
  };

  const clearOpeningFlag = () => {
    setNeedsOpening(false);
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, login, logout, needsOpening, clearOpeningFlag }}
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

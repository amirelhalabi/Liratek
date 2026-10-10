import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { logout as apiLogout, type MobileSession } from "@/api/auth";
import { setUnauthorizedHandler } from "@/api/client";
import { resetCache } from "@/data/queryClient";

import { clearToken, getShop, getToken, setShop, setToken, type StoredShop } from "./tokenStore";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: Status;
  shop: StoredShop | null;
  /** Remembered shop address for the sign-in form, kept after sign-out. */
  rememberedShop: StoredShop | null;
  completeSignIn: (session: MobileSession) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [shop, setShopState] = useState<StoredShop | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [token, storedShop] = await Promise.all([getToken(), getShop()]);
      if (cancelled) return;
      setShopState(storedShop);
      setStatus(token ? "signedIn" : "signedOut");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 (expired token, session revoked from web Settings) returns to sign-in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Drop the shop's cached pages before sign-in shows (LIRA-300 FR-013).
      void Promise.all([clearToken(), resetCache()]).then(() => setStatus("signedOut"));
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const completeSignIn = useCallback(async (session: MobileSession) => {
    const remembered = { slug: session.shop.slug, name: session.shop.name };
    // Guard against a cache left over if the app was killed mid sign-out.
    await resetCache();
    await setToken(session.token);
    await setShop(remembered);
    setShopState(remembered);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    await clearToken();
    await resetCache();
    setStatus("signedOut");
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      shop: status === "signedIn" ? shop : null,
      rememberedShop: shop,
      completeSignIn,
      signOut,
    }),
    [status, shop, completeSignIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

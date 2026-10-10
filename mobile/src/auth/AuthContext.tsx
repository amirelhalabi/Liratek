import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { logout as apiLogout, type MobileSession } from "@/api/auth";
import { setUnauthorizedHandler } from "@/api/client";

import { clearToken, getShop, getToken, setShop, setToken, type StoredShop } from "./tokenStore";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: Status;
  shop: StoredShop | null;
  /** Remembered shop address for the sign-in form, kept after sign-out. */
  rememberedShop: StoredShop | null;
  completeSignIn: (session: MobileSession) => Promise<void>;
  signOut: () => Promise<void>;
  /** Development builds only: open the signed-in screens without a server. */
  previewSignIn?: () => void;
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
      void clearToken().then(() => setStatus("signedOut"));
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const completeSignIn = useCallback(async (session: MobileSession) => {
    const remembered = { slug: session.shop.slug, name: session.shop.name };
    await setToken(session.token);
    await setShop(remembered);
    setShopState(remembered);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    await clearToken();
    setStatus("signedOut");
  }, []);

  // __DEV__ is false in release builds, so this never ships. No token is stored.
  const previewSignIn = useCallback(() => {
    setShopState({ slug: "preview", name: "Preview Shop" });
    setStatus("signedIn");
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      shop: status === "signedIn" ? shop : null,
      rememberedShop: shop,
      completeSignIn,
      signOut,
      ...(__DEV__ ? { previewSignIn } : {}),
    }),
    [status, shop, completeSignIn, signOut, previewSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

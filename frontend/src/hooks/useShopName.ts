import { useEffect, useState } from "react";
import { useApi } from "@liratek/ui";
import { useOptionalAuth } from "@/features/auth/context/AuthContext";

/**
 * NO default shop name, deliberately.
 *
 * This used to be the literal "Corner Tech" — one real customer's name,
 * shipped to every install. On the web it showed on EVERY login page, because
 * the pre-auth settings read fails (no tenant context without a JWT) and this
 * was the catch() fallback. So every shop was greeted with a stranger's name.
 *
 * An empty string is the honest answer to "what is this shop called" when
 * nothing has said yet. Every consumer already guards on it (TopBar renders
 * `shopName && ...`) or should — a blank is correct, an invented name is not.
 */
const NO_SHOP_NAME = "";

export interface ShopInfo {
  name: string;
  phone: string;
  location: string;
  /** Receipt logo as a data URL (base64), or "" when none is set. Printed as
   *  an <img> above the receipt text (RCP-0). */
  logo: string;
}

let cachedInfo: ShopInfo | null = null;
const listeners = new Set<(info: ShopInfo) => void>();

function notify(info: ShopInfo) {
  cachedInfo = info;
  listeners.forEach((fn) => fn(info));
}

const defaultInfo: ShopInfo = {
  name: NO_SHOP_NAME,
  phone: "",
  location: "",
  logo: "",
};

/** Load shop info once and share across all consumers */
export function useShopInfo(): ShopInfo {
  const api = useApi();
  // Optional on purpose: the shop name is decoration. Outside an AuthProvider
  // nobody is signed in, so there is nothing to fetch — that is an empty name,
  // not a crash that takes the surrounding component with it.
  const isAuthenticated = useOptionalAuth()?.isAuthenticated ?? false;
  const [info, setInfo] = useState<ShopInfo>(cachedInfo ?? defaultInfo);

  useEffect(() => {
    listeners.add(setInfo);

    // Gated on auth, and the fetch is only CACHED when it succeeds.
    //
    // Both halves matter. The settings read is tenant-scoped, so before
    // login there is no tenant and nothing to ask for; and the old code
    // cached whatever the first attempt produced -- which, because that
    // attempt happened on the LOGIN page, meant a failure was cached
    // permanently and never retried once the user signed in.
    if (isAuthenticated && cachedInfo === null) {
      api
        .getAllSettings()
        .then((settings: any[]) => {
          const map = new Map(settings.map((s: any) => [s.key_name, s.value]));
          const name =
            typeof map.get("shop_name") === "string" &&
            (map.get("shop_name") as string).trim()
              ? (map.get("shop_name") as string).trim()
              : NO_SHOP_NAME;
          const phone =
            typeof map.get("shop_phone") === "string"
              ? (map.get("shop_phone") as string).trim()
              : "";
          const location =
            typeof map.get("shop_location") === "string"
              ? (map.get("shop_location") as string).trim()
              : "";
          const logo =
            typeof map.get("receipt_logo") === "string"
              ? (map.get("receipt_logo") as string).trim()
              : "";
          notify({ name, phone, location, logo });
        })
        .catch(() => {
          // Deliberately NOT notify(): that writes to cachedInfo and would
          // make one failed request permanent. Leaving it null means the
          // next consumer to mount tries again.
          setInfo(defaultInfo);
        });
    }

    return () => {
      listeners.delete(setInfo);
    };
  }, [isAuthenticated]);

  return info;
}

/** Convenience wrapper — returns just the shop name string */
export function useShopName(): string {
  return useShopInfo().name;
}

/** Invalidate cached shop info so next consumer re-fetches */
export function invalidateShopInfo() {
  cachedInfo = null;
}

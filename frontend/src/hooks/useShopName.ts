import { useEffect, useState } from "react";
import { useApi } from "@liratek/ui";

export interface ShopInfo {
  name: string;
  phone: string;
  location: string;
}

let cachedInfo: ShopInfo | null = null;
const listeners = new Set<(info: ShopInfo) => void>();

function notify(info: ShopInfo) {
  cachedInfo = info;
  listeners.forEach((fn) => fn(info));
}

const defaultInfo: ShopInfo = {
  name: "",
  phone: "",
  location: "",
};

/** Load shop info once and share across all consumers */
export function useShopInfo(): ShopInfo {
  const api = useApi();
  const [info, setInfo] = useState<ShopInfo>(cachedInfo ?? defaultInfo);

  useEffect(() => {
    listeners.add(setInfo);

    // Only fetch if not yet cached
    if (cachedInfo === null) {
      api
        .getAllSettings()
        .then((settings: any[]) => {
          const map = new Map(
            (settings || []).map((s: any) => [s.key_name, s.value]),
          );
          const name =
            typeof map.get("shop_name") === "string" &&
            (map.get("shop_name") as string).trim()
              ? (map.get("shop_name") as string).trim()
              : "";
          const phone =
            typeof map.get("shop_phone") === "string"
              ? (map.get("shop_phone") as string).trim()
              : "";
          const location =
            typeof map.get("shop_location") === "string"
              ? (map.get("shop_location") as string).trim()
              : "";
          notify({ name, phone, location });
        })
        .catch(() => {
          notify(defaultInfo);
        });
    }

    return () => {
      listeners.delete(setInfo);
    };
  }, []);

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

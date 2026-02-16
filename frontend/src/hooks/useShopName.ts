import { useEffect, useState } from "react";
import * as api from "../api/backendApi";

const DEFAULT_SHOP_NAME = "Corner Tech";

let cachedName: string | null = null;
const listeners = new Set<(name: string) => void>();

function notify(name: string) {
  cachedName = name;
  listeners.forEach((fn) => fn(name));
}

/** Load shop name once and share across all consumers */
export function useShopName(): string {
  const [name, setName] = useState(cachedName ?? DEFAULT_SHOP_NAME);

  useEffect(() => {
    listeners.add(setName);

    // Only fetch if not yet cached
    if (cachedName === null) {
      api
        .getSetting("shop_name")
        .then((s: any) => {
          const value = s?.value;
          const resolved =
            typeof value === "string" && value.trim()
              ? value.trim()
              : DEFAULT_SHOP_NAME;
          notify(resolved);
        })
        .catch(() => {
          notify(DEFAULT_SHOP_NAME);
        });
    }

    return () => {
      listeners.delete(setName);
    };
  }, []);

  return name;
}

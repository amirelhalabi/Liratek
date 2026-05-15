/**
 * useShopBase hook
 *
 * Returns the shop's base system and partner system.
 * Caches globally so all consumers share a single fetch.
 */

import { useEffect, useState } from "react";

type BaseSystem = "OMT" | "WHISH";

interface ShopBase {
  baseSystem: BaseSystem;
  partnerSystem: BaseSystem;
  loading: boolean;
}

let cachedBase: BaseSystem | null = null;
const listeners = new Set<(base: BaseSystem) => void>();

function notify(base: BaseSystem) {
  cachedBase = base;
  listeners.forEach((fn) => fn(base));
}

export function useShopBase(): ShopBase {
  const [baseSystem, setBaseSystem] = useState<BaseSystem>(cachedBase ?? "OMT");
  const [loading, setLoading] = useState(cachedBase === null);

  useEffect(() => {
    const handler = (base: BaseSystem) => {
      setBaseSystem(base);
      setLoading(false);
    };
    listeners.add(handler);

    if (cachedBase === null) {
      window.api.settings
        .getAll()
        .then((settings: Array<{ key_name: string; value: string }>) => {
          const setting = settings.find(
            (s) => s.key_name === "shop_base_system",
          );
          const val: BaseSystem = setting?.value === "WHISH" ? "WHISH" : "OMT";
          notify(val);
        })
        .catch(() => {
          notify("OMT");
        });
    }

    return () => {
      listeners.delete(handler);
    };
  }, []);

  return {
    baseSystem,
    partnerSystem: baseSystem === "OMT" ? "WHISH" : "OMT",
    loading,
  };
}

/** Invalidate cache (e.g. after setup sets it) */
export function invalidateShopBase() {
  cachedBase = null;
}

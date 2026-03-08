/**
 * useMobileServiceItems — normalizes the nested mobileServices catalog into a
 * flat, searchable list of selectable items grouped by provider & category.
 *
 * Also merges voucher images + saved item costs from the API.
 */

import { useMemo, useEffect, useState, useCallback } from "react";
import { useApi } from "@liratek/ui";
import mobileServices from "@/data/mobileServices";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Provider key as used in the financial_services DB table */
export type ProviderKey = "IPEC" | "KATCH" | "WISH_APP";

/** A single selectable service item */
export interface ServiceItem {
  /** Unique key: `${provider}/${category}/${label}` */
  key: string;
  provider: ProviderKey;
  /** Top-level category e.g. "Gaming cards" */
  category: string;
  /** Sub-category or group name e.g. "pubg voucher" */
  subcategory: string;
  /** Human-readable label e.g. "60UC" or "3.6" */
  label: string;
  /** Cost price from the catalog (in LBP) */
  catalogCost?: number;
  /** Saved default cost from item_costs table */
  savedCost?: number;
  /** Saved voucher image (base64 or URL) */
  imageData?: string;
}

/** Shape of a row returned by the item-costs API */
interface ItemCostRow {
  provider: string;
  category: string;
  item_key: string;
  cost: number | string;
}

/** Shape of a row returned by the voucher-images API */
interface VoucherImageRow {
  provider: string;
  category: string;
  item_key: string;
  image_data: string;
}

/** Map from provider display name → DB provider key */
const PROVIDER_MAP: Record<string, ProviderKey> = {
  "i-Pick": "IPEC",
  Katsh: "KATCH",
  "Whish App": "WISH_APP",
};

// ─── Static catalog parsing (runs once) ────────────────────────────────────

function parseCatalog(): ServiceItem[] {
  const result: ServiceItem[] = [];

  for (const [providerName, catalog] of Object.entries(mobileServices)) {
    const providerKey = PROVIDER_MAP[providerName];
    if (!providerKey) continue; // skip unknown providers (e.g. "Validity vouchers")

    for (const [categoryName, subcategories] of Object.entries(catalog)) {
      for (const [subName, itemsOrNested] of Object.entries(subcategories)) {
        if (Array.isArray(itemsOrNested)) {
          // Empty array = free-form category (e.g. i-Pick gaming items)
          result.push({
            key: `${providerKey}/${categoryName}/${subName}`,
            provider: providerKey,
            category: categoryName,
            subcategory: subName,
            label: subName,
          });
        } else if (typeof itemsOrNested === "object") {
          // Object — could be items or deeper nesting
          for (const [labelOrGroup, costOrNested] of Object.entries(
            itemsOrNested,
          )) {
            if (typeof costOrNested === "string") {
              // Direct item: label → cost
              result.push({
                key: `${providerKey}/${categoryName}/${subName}/${labelOrGroup}`,
                provider: providerKey,
                category: categoryName,
                subcategory: subName,
                label: labelOrGroup,
                catalogCost: Number(costOrNested),
              });
            } else if (
              typeof costOrNested === "object" &&
              !Array.isArray(costOrNested)
            ) {
              // One level deeper (e.g. Katsh > mobile topups > alfa > voucher > items)
              for (const [deepLabel, deepCost] of Object.entries(
                costOrNested,
              )) {
                if (typeof deepCost === "string") {
                  result.push({
                    key: `${providerKey}/${categoryName}/${subName}/${labelOrGroup}/${deepLabel}`,
                    provider: providerKey,
                    category: categoryName,
                    subcategory: `${subName} / ${labelOrGroup}`,
                    label: deepLabel,
                    catalogCost: Number(deepCost),
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return result;
}

/** Parsed once at module level — the catalog data is static */
const BASE_ITEMS = parseCatalog();

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useMobileServiceItems() {
  const api = useApi();
  const [itemCosts, setItemCosts] = useState<ItemCostRow[]>([]);
  const [voucherImages, setVoucherImages] = useState<VoucherImageRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load saved costs + images once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [costs, images] = await Promise.all([
          api.getItemCosts(),
          api.getVoucherImages(),
        ]);
        if (!cancelled) {
          setItemCosts(costs ?? []);
          setVoucherImages(images ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Merge saved costs & images onto the static catalog items
  const items = useMemo<ServiceItem[]>(() => {
    if (!itemCosts.length && !voucherImages.length) return BASE_ITEMS;

    // Build O(1) lookup maps keyed by "provider|category|item_key"
    const costMap = new Map<string, number>();
    for (const c of itemCosts) {
      costMap.set(`${c.provider}|${c.category}|${c.item_key}`, Number(c.cost));
    }

    const imageMap = new Map<string, string>();
    for (const v of voucherImages) {
      imageMap.set(`${v.provider}|${v.category}|${v.item_key}`, v.image_data);
    }

    return BASE_ITEMS.map((item) => {
      const lookupKey = `${item.provider}|${item.category}|${item.key}`;
      const savedCost = costMap.get(lookupKey);
      const imageData = imageMap.get(lookupKey);

      if (savedCost === undefined && imageData === undefined) return item;

      return {
        ...item,
        ...(savedCost !== undefined && { savedCost }),
        ...(imageData !== undefined && { imageData }),
      };
    });
  }, [itemCosts, voucherImages]);

  // Group items by provider
  const itemsByProvider = useMemo(() => {
    const map: Record<ProviderKey, ServiceItem[]> = {
      IPEC: [],
      KATCH: [],
      WISH_APP: [],
    };
    for (const item of items) {
      map[item.provider].push(item);
    }
    return map;
  }, [items]);

  // Get categories for a provider
  const getCategoriesForProvider = useCallback(
    (provider: ProviderKey): string[] => {
      const provItems = itemsByProvider[provider] || [];
      return [...new Set(provItems.map((i) => i.category))];
    },
    [itemsByProvider],
  );

  // Get items for a provider + category
  const getItems = useCallback(
    (provider: ProviderKey, category?: string): ServiceItem[] => {
      const provItems = itemsByProvider[provider] || [];
      if (!category) return provItems;
      return provItems.filter((i) => i.category === category);
    },
    [itemsByProvider],
  );

  // Refresh data from API
  const refresh = useCallback(async () => {
    try {
      const [costs, images] = await Promise.all([
        api.getItemCosts(),
        api.getVoucherImages(),
      ]);
      setItemCosts(costs ?? []);
      setVoucherImages(images ?? []);
    } catch {
      // silently ignore
    }
  }, [api]);

  return {
    items,
    itemsByProvider,
    getCategoriesForProvider,
    getItems,
    loaded,
    refresh,
  };
}

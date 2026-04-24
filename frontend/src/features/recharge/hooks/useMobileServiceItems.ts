/**
 * useMobileServiceItems — loads the mobile services catalog from the database
 * and exposes a flat, searchable list of selectable items grouped by provider
 * & category.
 *
 * On first launch (empty DB table) it seeds the DB from the static
 * mobileServices.ts catalog, then switches to DB-only reads.
 *
 * Also merges voucher images + saved item costs from the legacy API for
 * backwards compatibility.
 */

import { useMemo, useEffect, useState, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { MobileServiceItem } from "@/types/electron";
import { parseCatalogToSeedData } from "../utils/parseCatalogToSeedData";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Provider key as used in the financial_services DB table */
export type ProviderKey =
  | "iPick"
  | "Katsh"
  | "WISH_APP"
  | "OMT_APP"
  | "VOUCHER";

/** A single selectable service item */
export interface ServiceItem {
  /** Unique key: `${provider}/${category}/${subcategory}/${label}` */
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
  /** Selling price from the catalog (in LBP) */
  catalogSellPrice?: number;
  /** Saved default cost from item_costs table */
  savedCost?: number;
  /** Saved voucher image (base64 or URL) */
  imageData?: string;
  /** Sort order from DB */
  sortOrder: number;
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

// ─── Sorting ───────────────────────────────────────────────────────────────

/** Extract the leading number from a label string.
 *  "3.6" → 3.6, "1GB" → 1, "10 days" → 10, "3$" → 3,
 *  "credit only 1.67$" → 1.67, "Alfa Go" → NaN */
function extractNumber(label: string): number {
  // Try parsing the whole label first (handles "3.6", "10", etc.)
  const direct = parseFloat(label);
  if (!isNaN(direct)) return direct;
  // Extract first number sequence (handles "credit only 1.67$", etc.)
  const match = label.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : NaN;
}

/** Sort items ascending: numeric labels first (by value), then non-numeric (by sortOrder) */
function sortItems(items: ServiceItem[]): ServiceItem[] {
  return [...items].sort((a, b) => {
    const numA = extractNumber(a.label);
    const numB = extractNumber(b.label);
    const aIsNum = !isNaN(numA);
    const bIsNum = !isNaN(numB);

    if (aIsNum && bIsNum) return numA - numB;
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useMobileServiceItems() {
  const api = useApi();
  const [dbItems, setDbItems] = useState<MobileServiceItem[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCostRow[]>([]);
  const [voucherImages, setVoucherImages] = useState<VoucherImageRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load DB items (seed if needed) + legacy costs/images once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Check if DB needs seeding
        const countResult = await window.api.mobileServiceItems.count();
        if (countResult.success && countResult.data === 0) {
          const seedData = parseCatalogToSeedData();
          await window.api.mobileServiceItems.seed(seedData);
        }

        // Load all active items from DB + legacy overrides in parallel
        const [allResult, costs, images] = await Promise.all([
          window.api.mobileServiceItems.getAll(),
          api.getItemCosts(),
          api.getVoucherImages(),
        ]);

        if (!cancelled) {
          setDbItems(allResult.success ? (allResult.data ?? []) : []);
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

  // Map DB items → ServiceItem and merge legacy costs / images
  const items = useMemo<ServiceItem[]>(() => {
    const baseItems: ServiceItem[] = dbItems.map((item) => ({
      key: `${item.provider}/${item.category}/${item.subcategory}/${item.label}`,
      provider: item.provider as ProviderKey,
      category: item.category,
      subcategory: item.subcategory,
      label: item.label,
      catalogCost: item.cost_lbp,
      catalogSellPrice: item.sell_lbp,
      sortOrder: item.sort_order,
    }));

    if (!itemCosts.length && !voucherImages.length) return baseItems;

    // Build O(1) lookup maps keyed by "provider|category|item_key"
    const costMap = new Map<string, number>();
    for (const c of itemCosts) {
      costMap.set(`${c.provider}|${c.category}|${c.item_key}`, Number(c.cost));
    }

    const imageMap = new Map<string, string>();
    for (const v of voucherImages) {
      imageMap.set(`${v.provider}|${v.category}|${v.item_key}`, v.image_data);
    }

    return baseItems.map((item) => {
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
  }, [dbItems, itemCosts, voucherImages]);

  // Group items by provider
  const itemsByProvider = useMemo(() => {
    const map: Record<ProviderKey, ServiceItem[]> = {
      iPick: [],
      Katsh: [],
      WISH_APP: [],
      OMT_APP: [],
      VOUCHER: [],
    };
    for (const item of items) {
      if (item.provider in map) {
        map[item.provider].push(item);
      }
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

  // Get items for a provider + category (sorted ascending by numeric label)
  const getItems = useCallback(
    (provider: ProviderKey, category?: string): ServiceItem[] => {
      const provItems = itemsByProvider[provider] || [];
      const filtered = category
        ? provItems.filter((i) => i.category === category)
        : provItems;
      return sortItems(filtered);
    },
    [itemsByProvider],
  );

  // Refresh data from DB + legacy APIs
  const refresh = useCallback(async () => {
    try {
      const [allResult, costs, images] = await Promise.all([
        window.api.mobileServiceItems.getAll(),
        api.getItemCosts(),
        api.getVoucherImages(),
      ]);
      setDbItems(allResult.success ? (allResult.data ?? []) : []);
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

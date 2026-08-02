import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useApi } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { MobileServiceItem } from "@/types/electron";
import { parseCatalogToSeedData } from "@/features/recharge/utils/parseCatalogToSeedData";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ProviderKey =
  | "iPick"
  | "Katsh"
  | "WHISH_APP"
  | "OMT_APP"
  | "VOUCHER";

export interface ServiceItem {
  /** `mobile_service_items.id` — the DB primary key. Used by LIRA-090 Only-Days
   *  computed flow to send `mobileServiceItemId` to the repository. */
  id?: number;
  key: string;
  provider: ProviderKey;
  category: string;
  subcategory: string;
  label: string;
  catalogCost?: number;
  catalogSellPrice?: number;
  savedCost?: number;
  imageData?: string;
  sortOrder: number;
  /** Structured validity (days) — LIRA W6.b. Undefined when not applicable. */
  validityDays?: number;
  /** Structured credit amount (USD) — LIRA W6.b. Undefined when not applicable. */
  credits?: number;
  /** LIRA-090 (v140): LBP cost attributable to validity days alone.
   *  Null/undefined until configured. Presence (with cost_lbp + credits) enables
   *  the computed Only-Days flow (`isTelecomSplitComplete`). */
  days_cost_lbp?: number | null;
}

interface ItemCostRow {
  provider: string;
  category: string;
  item_key: string;
  cost: number | string;
}

interface VoucherImageRow {
  provider: string;
  category: string;
  item_key: string;
  image_data: string;
}

// ─── Sorting ───────────────────────────────────────────────────────────────

const CATEGORY_ORDER: string[] = ["alfa", "mtc", "internet", "Gaming"];

function categoryIndex(cat: string): number {
  const idx = CATEGORY_ORDER.indexOf(cat);
  return idx >= 0 ? idx : CATEGORY_ORDER.length;
}

function extractNumber(label: string): number {
  const direct = parseFloat(label);
  if (!isNaN(direct)) return direct;
  const match = label.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : NaN;
}

function sortItemsWithinSubcategory(items: ServiceItem[]): ServiceItem[] {
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

function sortItems(items: ServiceItem[]): ServiceItem[] {
  const groups = new Map<string, ServiceItem[]>();
  const groupMinOrder = new Map<string, number>();

  for (const item of items) {
    const key = item.subcategory;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupMinOrder.set(key, item.sortOrder);
    }
    groups.get(key)!.push(item);
    const cur = groupMinOrder.get(key)!;
    if (item.sortOrder < cur) groupMinOrder.set(key, item.sortOrder);
  }

  const orderedKeys = [...groups.keys()].sort(
    (a, b) => groupMinOrder.get(a)! - groupMinOrder.get(b)!,
  );

  const result: ServiceItem[] = [];
  for (const key of orderedKeys) {
    result.push(...sortItemsWithinSubcategory(groups.get(key)!));
  }
  return result;
}

// ─── Context ───────────────────────────────────────────────────────────────

interface MobileServiceItemsContextValue {
  items: ServiceItem[];
  itemsByProvider: Record<ProviderKey, ServiceItem[]>;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getItems: (provider: ProviderKey, category?: string) => ServiceItem[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

const MobileServiceItemsContext =
  createContext<MobileServiceItemsContextValue | null>(null);

export function MobileServiceItemsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const api = useApi();
  const { isAuthenticated } = useAuth();
  const [dbItems, setDbItems] = useState<MobileServiceItem[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCostRow[]>([]);
  const [voucherImages, setVoucherImages] = useState<VoucherImageRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const countResult = await window.api.mobileServiceItems.count();
      if (countResult.success && countResult.data === 0) {
        const seedData = parseCatalogToSeedData();
        await window.api.mobileServiceItems.seed(seedData);
      }

      const [allResult, costs, images] = await Promise.all([
        window.api.mobileServiceItems.getAll(),
        api.getItemCosts(),
        api.getVoucherImages(),
      ]);

      setDbItems(allResult.success ? (allResult.data ?? []) : []);
      setItemCosts(costs ?? []);
      setVoucherImages(images ?? []);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [api]);

  // Only load once authenticated — seeding an empty catalog requires an
  // admin/staff session, and read handlers run after login. Re-runs whenever
  // the user logs in so a fresh DB gets seeded at that point (not at boot).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  const items = useMemo<ServiceItem[]>(() => {
    const baseItems: ServiceItem[] = dbItems.map((item) => ({
      id: item.id,
      key: `${item.provider}/${item.category}/${item.subcategory}/${item.label}`,
      provider: item.provider as ProviderKey,
      category: item.category,
      subcategory: item.subcategory,
      label: item.label,
      catalogCost: item.cost_lbp,
      catalogSellPrice: item.sell_lbp,
      sortOrder: item.sort_order,
      ...(item.validity_days != null
        ? { validityDays: item.validity_days }
        : {}),
      ...(item.credits != null ? { credits: item.credits } : {}),
      // LIRA-090: days_cost_lbp enables the computed Only-Days split gate.
      ...(item.days_cost_lbp != null
        ? { days_cost_lbp: item.days_cost_lbp }
        : {}),
    }));

    if (!itemCosts.length && !voucherImages.length) return baseItems;

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

  const itemsByProvider = useMemo(() => {
    const map: Record<ProviderKey, ServiceItem[]> = {
      iPick: [],
      Katsh: [],
      WHISH_APP: [],
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

  // Pre-sorted slices keyed by "provider|category" (category="" = all items for provider).
  // Avoids re-running sortItems() on every getItems() call.
  const sortedSlices = useMemo(() => {
    const cache = new Map<string, ServiceItem[]>();
    for (const [provider, provItems] of Object.entries(itemsByProvider) as [
      ProviderKey,
      ServiceItem[],
    ][]) {
      cache.set(`${provider}|`, sortItems(provItems));
      const cats = [...new Set(provItems.map((i) => i.category))];
      for (const cat of cats) {
        cache.set(
          `${provider}|${cat}`,
          sortItems(provItems.filter((i) => i.category === cat)),
        );
      }
    }
    return cache;
  }, [itemsByProvider]);

  const getCategoriesForProvider = useCallback(
    (provider: ProviderKey): string[] => {
      const provItems = itemsByProvider[provider] || [];
      const cats = [...new Set(provItems.map((i) => i.category))];
      return cats.sort((a, b) => categoryIndex(a) - categoryIndex(b));
    },
    [itemsByProvider],
  );

  const getItems = useCallback(
    (provider: ProviderKey, category?: string): ServiceItem[] => {
      return sortedSlices.get(`${provider}|${category ?? ""}`) ?? [];
    },
    [sortedSlices],
  );

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

  return (
    <MobileServiceItemsContext.Provider
      value={{
        items,
        itemsByProvider,
        getCategoriesForProvider,
        getItems,
        loaded,
        refresh,
      }}
    >
      {children}
    </MobileServiceItemsContext.Provider>
  );
}

export function useMobileServiceItemsContext(): MobileServiceItemsContextValue {
  const ctx = useContext(MobileServiceItemsContext);
  if (!ctx)
    throw new Error(
      "useMobileServiceItemsContext must be used within MobileServiceItemsProvider",
    );
  return ctx;
}

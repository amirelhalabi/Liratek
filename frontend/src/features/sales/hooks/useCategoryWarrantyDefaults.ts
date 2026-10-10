import { useQuery } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";

/**
 * LIRA-296 — each category's default warranty (Settings → Categories), keyed
 * by category NAME (lower-cased), for the POS cart's "Warranty: N months"
 * hint. One shared query for every cart line. The server resolves the real
 * stamp itself; this only shows the cashier what the default will be.
 */
interface CategoriesApi {
  getCategoriesFull: () => Promise<
    Array<{ name: string; warranty_months?: number | null }>
  >;
}

export const CATEGORY_WARRANTY_KEY = ["categories-full", "warranty"] as const;

export function useCategoryWarrantyDefaults(): Map<string, number | null> {
  const api = useApi() as unknown as CategoriesApi;
  const { data } = useQuery({
    queryKey: CATEGORY_WARRANTY_KEY,
    queryFn: () => api.getCategoriesFull(),
    staleTime: 60_000,
  });
  const map = new Map<string, number | null>();
  for (const c of data ?? []) {
    map.set(c.name.trim().toLowerCase(), c.warranty_months ?? null);
  }
  return map;
}

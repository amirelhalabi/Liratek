import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";

/**
 * LIRA-143 phase 6a — the POS cart's IN_STOCK unit picker (CartLineRow) and
 * the add-to-cart gate (POS/index.tsx's `handleAddToCart`) both need the
 * same per-product IN_STOCK unit list. Sharing one TanStack Query key means
 * the add-time `fetchInStockUnits` call (which decides picker vs nothing,
 * per cartGate.ts) populates the cache the picker then reads
 * instantly instead of re-fetching — the DB-level IN_STOCK count for a
 * product doesn't change while the cart is being built (units only flip to
 * SOLD when the sale actually completes), so there's no staleness risk in
 * reusing it.
 */

export interface ProductUnitRow {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  is_defective: number;
}

/** Minimal shape this module needs from `useApi()` — kept narrow so tests
 *  can mock just this slice instead of the whole ApiAdapter. */
interface ProductUnitsApi {
  productUnits: {
    getForProduct: (
      productId: number,
      status?: "IN_STOCK" | "SOLD",
    ) => Promise<unknown>;
  };
}

export const PRODUCT_UNIT_KEYS = {
  inStock: (productId: number) =>
    ["product-units", "in-stock", productId] as const,
};

export function useInStockUnitsQuery(productId: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: PRODUCT_UNIT_KEYS.inStock(productId ?? 0),
    queryFn: () => fetchInStockUnits(api as ProductUnitsApi, productId!),
    enabled: !!productId,
    select: (data) => data ?? [],
  });
}

function fetchInStockUnits(
  api: ProductUnitsApi,
  productId: number,
): Promise<ProductUnitRow[]> {
  return api.productUnits.getForProduct(productId, "IN_STOCK") as Promise<
    ProductUnitRow[]
  >;
}

/**
 * One-off (non-subscribing) read used at add-to-cart time, before the item
 * exists in cart state — `handleAddToCart` needs the registered-unit count
 * to decide the line's mode BEFORE pushing it. Goes through the same
 * queryKey as `useInStockUnitsQuery` via `queryClient.fetchQuery` so the
 * result is cached for the picker that renders right after.
 */
export function fetchInStockUnitsCached(
  queryClient: QueryClient,
  api: ProductUnitsApi,
  productId: number,
): Promise<ProductUnitRow[]> {
  return queryClient.fetchQuery({
    queryKey: PRODUCT_UNIT_KEYS.inStock(productId),
    queryFn: () => fetchInStockUnits(api, productId),
  });
}

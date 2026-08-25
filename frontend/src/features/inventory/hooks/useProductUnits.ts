import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";
import type { WarrantyStatus } from "../productUnitsLogic";

// Re-exported for convenience — callers that only need the warranty-status
// shape (e.g. ImeiStoryCard) can import it from either this hooks file or
// `../productUnitsLogic` directly.
export type { WarrantyStatus, WarrantySource, WarrantyState } from "../productUnitsLogic";

/**
 * Product Units (LIRA-143 Phase 6b) — TanStack Query hooks over
 * `useApi().productUnits`, same pattern as `hooks/useStockAdjustments.ts`.
 *
 * `useApi().productUnits` is typed against `any[]`/`any` at the boundary
 * (the shared `ApiAdapter` interface in `packages/ui/src/api/types.ts`,
 * outside this module's file boundary) — every read here casts ONCE, right
 * after the call, to the proper interfaces below, so nothing downstream in
 * this feature ever touches `any`.
 */

export interface ProductUnit {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  sale_item_id: number | null;
  is_defective: number; // SQLite boolean (0/1)
  warranty_override_until: string | null;
  created_at: string;
  updated_at: string;
}

/** One `getStory` row — a unit joined with its (if ever sold) sale/client
 *  provenance and its computed warranty verdict. Fields below are `null`
 *  for a unit that was never sold. */
export interface UnitStoryEntry extends ProductUnit {
  product_name: string | null;
  warranty_until: string | null;
  is_refunded: number | null;
  refunded_quantity: number | null;
  quantity: number | null;
  sold_price_usd: number | null;
  sale_id: number | null;
  sold_at: string | null;
  client_id: number | null;
  client_name: string | null;
  warranty: WarrantyStatus;
}

export interface RegisterUnitsDrift {
  inStockUnits: number;
  stockQuantity: number;
  matches: boolean;
}

export interface RegisterUnitsResult {
  success: boolean;
  data?: { units: ProductUnit[]; drift: RegisterUnitsDrift };
  error?: string;
}

export const PRODUCT_UNITS_KEYS = {
  byProduct: (productId: number) => ["product-units", productId] as const,
  story: (imei: string) => ["product-units-story", imei] as const,
};

/** All units for one product (both `IN_STOCK` and `SOLD`), oldest first. */
export function useProductUnitsQuery(productId: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: PRODUCT_UNITS_KEYS.byProduct(productId ?? 0),
    queryFn: async () =>
      (await api.productUnits.getForProduct(productId ?? 0)) as ProductUnit[],
    enabled: productId != null,
  });
}

/** Batch IMEI intake — invalidates this product's unit list AND `["products"]`
 *  (a register never changes `stock_quantity` itself, but the drift banner
 *  wants a fresh read either way). */
export function useRegisterUnitsMutation(productId: number | null) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (imeis: string[]) => {
      const result = await api.productUnits.register({
        product_id: productId ?? 0,
        imeis,
      });
      return result as RegisterUnitsResult;
    },
    onSuccess: () => {
      if (productId != null) {
        queryClient.invalidateQueries({
          queryKey: PRODUCT_UNITS_KEYS.byProduct(productId),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/** Delete an intake mistake — `IN_STOCK` only (the backend refuses a `SOLD`
 *  unit; the UI never offers the button for one, see `ProductUnitsSection`). */
export function useDeleteUnitMutation(productId: number | null) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (unitId: number) => {
      const result = await api.productUnits.delete(unitId);
      return result as { success: boolean; error?: string };
    },
    onSuccess: () => {
      if (productId != null) {
        queryClient.invalidateQueries({
          queryKey: PRODUCT_UNITS_KEYS.byProduct(productId),
        });
      }
    },
  });
}

/** The walk-in lookup (decision #7) — every unit matching `imei` exactly,
 *  warranty-stamped. `imei === null` (heuristic didn't match the search
 *  term) disables the query entirely — no request, no cache entry. */
export function useUnitStoryQuery(imei: string | null) {
  const api = useApi();
  const trimmed = imei?.trim() ?? "";
  return useQuery({
    queryKey: PRODUCT_UNITS_KEYS.story(trimmed),
    queryFn: async () =>
      (await api.productUnits.getStory(trimmed)) as UnitStoryEntry[],
    enabled: trimmed.length > 0,
  });
}

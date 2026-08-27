import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";
import type { WarrantyStatus } from "../productUnitsLogic";

// Re-exported for convenience — callers that only need the warranty-status
// shape (e.g. ImeiStoryCard) can import it from either this hooks file or
// `../productUnitsLogic` directly.
export type {
  WarrantyStatus,
  WarrantySource,
  WarrantyState,
} from "../productUnitsLogic";

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
  /** The owning MODEL's warranty term (`products.warranty_months`) —
   *  display-only: decision #4 starts the warranty clock at the SALE, so an
   *  unsold unit has no coverage yet, only a term it will get. */
  product_warranty_months: number | null;
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

/**
 * Filters accepted by the paginated unit list (`product-units:list` /
 * `POST /api/product-units/list`). Mirrors core's `UnitListFilters` —
 * duplicated frontend-side on purpose, same convention as `ProductUnit` /
 * `UnitStoryEntry` above and the refund DTOs in
 * features/audit/refundLegOverride.ts.
 *
 * `limit`/`offset` are REQUIRED here even though the Zod schema defaults them
 * (50 / 0) — the caller always knows its page size, and making them explicit
 * keeps the query key (which is the filter object itself) unambiguous.
 */
export interface UnitListFilters {
  status?: "IN_STOCK" | "SOLD";
  defectiveOnly?: boolean;
  /** LIKE-matched against IMEI OR product name; max 64 chars (Zod). */
  search?: string;
  limit: number;
  offset: number;
}

/** One row of the paginated unit list — the unit plus its (if ever sold)
 *  sale/client provenance. Sold-side fields are `null` for a unit that was
 *  never sold; `sale_refunded` is `null` in that case and 0/1 once sold. */
export interface UnitListRow {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  is_defective: number; // SQLite boolean (0/1)
  warranty_override_until: string | null;
  created_at: string;
  product_name: string;
  /** The owning MODEL's warranty term — display-only (see
   *  {@link UnitStoryEntry.product_warranty_months}); what lets fresh stock
   *  of a 6-month model read "6 mo — starts at sale" instead of the
   *  misleading "No warranty". */
  product_warranty_months: number | null;
  sale_item_id: number | null;
  sold_at: string | null;
  sold_price_usd: number | null;
  client_name: string | null;
  warranty_until: string | null;
  sale_refunded: 0 | 1 | null;
}

/** A list row stamped with the same warranty verdict `getStory` computes
 *  (identical precedence: override → refund → sale). */
export type UnitListRowWithWarranty = UnitListRow & {
  warranty: WarrantyStatus;
};

export interface UnitListResult {
  rows: UnitListRowWithWarranty[];
  /** COUNT(*) over the identical WHERE — the pagination denominator, NOT
   *  `rows.length`. */
  total: number;
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
  /** Prefix shared by EVERY IMEI's story entry — invalidating this refetches
   *  whichever unit card is expanded. Needed because a unit's rendered
   *  warranty text depends on its PRODUCT's `warranty_months`, which a
   *  product save can change without touching any `product_units` row. */
  storyRoot: ["product-units-story"] as const,
  /** Prefix shared by EVERY filter/page combination of the unit list —
   *  invalidating this refetches whichever page is on screen. */
  listRoot: ["product-units-list"] as const,
  list: (filters: UnitListFilters) => ["product-units-list", filters] as const,
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
      // The standalone Phone Units page deletes without a productId in hand
      // (`useDeleteUnitMutation(null)`); invalidating the list prefix keeps
      // its current page fresh either way.
      queryClient.invalidateQueries({
        queryKey: PRODUCT_UNITS_KEYS.listRoot,
      });
    },
  });
}

/**
 * The paginated Phone Units list (the standalone management view). Keyed on
 * the WHOLE filter object — TanStack hashes it stably, so each
 * status/defective/search/page combination gets its own cache entry and
 * flipping back to a visited page is instant.
 *
 * Unlike the reads above this one needs NO cast: `productUnits.list` is fully
 * typed on the shared `ApiAdapter` (`ProductUnitListFilters` /
 * `ProductUnitListResult`), and the `Promise<UnitListResult>` annotation below
 * is what pins that adapter shape to this module's interfaces — if the two
 * ever drift, this line is the compile error.
 *
 * Reads return the RAW `UnitListResult` (never an envelope) per the adapter
 * contract, so a failure surfaces as a thrown query error, not `success:false`.
 */
export function useUnitListQuery(filters: UnitListFilters) {
  const api = useApi();
  return useQuery({
    queryKey: PRODUCT_UNITS_KEYS.list(filters),
    queryFn: async (): Promise<UnitListResult> =>
      await api.productUnits.list(filters),
  });
}

/**
 * A `productUnits.list` caller. Declared structurally (rather than reaching
 * into the shared `ApiAdapter` type) so {@link fetchAllUnitsForExport} can be
 * unit-tested with a plain jest mock, and so the page passes an arrow that
 * type-checks at the call site exactly like `useUnitListQuery` does.
 */
export type UnitListFetcher = (
  filters: UnitListFilters,
) => Promise<UnitListResult>;

export interface UnitExportFetchResult {
  /** Every row matching the filters, up to the plan's cap. */
  rows: UnitListRowWithWarranty[];
  /** True when the filters matched MORE rows than the cap allows. */
  capped: boolean;
  /** How many `list` calls were made — the loop's own accounting. */
  calls: number;
}

/**
 * Owner item #6 — assemble EVERY row matching the current filters by looping
 * the paginated list, so an export is the whole filtered result set and not
 * just the page on screen.
 *
 * `plan` comes from `planExportFetch(total)` (page-owned pure arithmetic), so
 * the cap and the page size are decided in one testable place and this
 * function is only the I/O.
 *
 * Two deliberate properties:
 *   - It stops as soon as a page comes back SHORT. A concurrent delete can
 *     shrink the result set mid-loop; continuing would fire requests for
 *     offsets past the end and pad nothing useful.
 *   - It never over-collects: the final slice honours `plan.rowCount`, so a
 *     server that ignores a short last `limit` still yields exactly the capped
 *     number of rows.
 */
export async function fetchAllUnitsForExport(
  list: UnitListFetcher,
  baseFilters: Omit<UnitListFilters, "limit" | "offset">,
  plan: {
    rowCount: number;
    capped: boolean;
    pages: Array<{ limit: number; offset: number }>;
  },
): Promise<UnitExportFetchResult> {
  const rows: UnitListRowWithWarranty[] = [];
  let calls = 0;
  for (const page of plan.pages) {
    const result = await list({
      ...baseFilters,
      limit: page.limit,
      offset: page.offset,
    });
    calls += 1;
    rows.push(...result.rows);
    if (result.rows.length < page.limit) break;
    if (rows.length >= plan.rowCount) break;
  }
  return { rows: rows.slice(0, plan.rowCount), capped: plan.capped, calls };
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

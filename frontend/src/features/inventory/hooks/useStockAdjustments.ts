import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";

/**
 * LIRA-077 — stock adjustment audit trail (per-product history + the
 * adjust-stock mutation). `["products"]` is invalidated defensively on
 * success so any future TanStack-Query-backed product list picks up the new
 * stock_quantity for free; ProductList.tsx today still refreshes via its own
 * imperative `loadProducts()` (passed in as `onSuccess` by the modal caller).
 */
export const STOCK_ADJUSTMENT_KEYS = {
  byProduct: (productId: number) => ["stock-adjustments", productId] as const,
};

export function useStockAdjustmentsQuery(productId: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: STOCK_ADJUSTMENT_KEYS.byProduct(productId ?? 0),
    queryFn: () => api.getStockAdjustments(productId ?? undefined),
    enabled: !!productId,
    select: (data) => data ?? [],
  });
}

export function useAdjustStockMutation() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      id: number;
      newQuantity?: number;
      delta?: number;
      reason: string;
    }) => api.adjustStock(payload),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({
        queryKey: STOCK_ADJUSTMENT_KEYS.byProduct(variables.id),
      });
    },
  });
}

/**
 * Supplier stock-intake (SUPPLIER_STOCK_INTAKE_PLAN.md) — used by
 * AdjustStockModal in place of `useAdjustStockMutation` whenever the
 * resolved change is an INCREASE, so a real delivery books a FIFO cost
 * batch and (unless `is_old_stock`/no supplier) a supplier_ledger debit,
 * instead of the plain stock_adjustments audit row a decrease still uses.
 * Same invalidation shape as the adjust-stock mutation above — both mutate
 * `products.stock_quantity` for the same product.
 */
export function useReceiveStockMutation() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      product_id: number;
      quantity: number;
      unit_cost_usd: number;
      supplier?: string | null;
      is_old_stock: boolean;
      reason?: string;
    }) => api.receiveStock(payload),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({
        queryKey: STOCK_ADJUSTMENT_KEYS.byProduct(variables.product_id),
      });
    },
  });
}

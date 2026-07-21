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

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";

// ── Shared query keys ─────────────────────────────────────────────────────────
export const SUPPLIER_KEYS = {
  all: ["suppliers"] as const,
  balances: ["supplier-balances"] as const,
  productBalances: ["supplier-product-balances"] as const,
  productItems: (id: number) => ["supplier-product-items", id] as const,
  ledger: (id: number) => ["supplier-ledger", id] as const,
  unsettled: (provider: string) => ["supplier-unsettled", provider] as const,
  allTransactions: (provider: string) =>
    ["supplier-all-transactions", provider] as const,
  purchases: (id: number) => ["supplier-purchases", id] as const,
};

// ── Queries ───────────────────────────────────────────────────────────────────

export function useSuppliersQuery() {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.all,
    queryFn: () => api.getSuppliers(undefined, true),
  });
}

export function useSupplierBalancesQuery() {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.balances,
    queryFn: () => api.getSupplierBalances(true),
  });
}

export function useSupplierLedgerQuery(supplierId: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.ledger(supplierId ?? 0),
    queryFn: () => api.getSupplierLedger(supplierId!, 200),
    enabled: !!supplierId,
  });
}

export function useProductSupplierBalancesQuery() {
  return useQuery({
    queryKey: SUPPLIER_KEYS.productBalances,
    queryFn: () => window.api.suppliers.getProductBalances(),
  });
}

export function useProductItemsQuery(supplierId: number | null) {
  return useQuery({
    queryKey: SUPPLIER_KEYS.productItems(supplierId ?? 0),
    queryFn: () => window.api.suppliers.getProductItems(supplierId!),
    enabled: !!supplierId,
  });
}

export function useUnsettledTransactionsQuery(provider: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.unsettled(provider ?? ""),
    queryFn: () =>
      (
        api as unknown as {
          getUnsettledTransactions: (p: string) => Promise<unknown[]>;
        }
      ).getUnsettledTransactions(provider!),
    enabled: !!provider,
    select: (data) => data ?? [],
  });
}

export function useAllTransactionsQuery(provider: string | null) {
  return useQuery({
    queryKey: SUPPLIER_KEYS.allTransactions(provider ?? ""),
    queryFn: () => window.api.suppliers.getAllTransactions(provider!),
    enabled: !!provider,
    select: (data) => data ?? [],
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useAddLedgerEntryMutation(supplierId: number | null) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      supplier_id: number;
      entry_type: string;
      amount_usd?: number;
      amount_lbp?: number;
      note?: string;
      drawer_name?: string;
    }) => api.addSupplierLedgerEntry(supplierId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.all });
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.balances });
      if (supplierId) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.ledger(supplierId),
        });
      }
    },
  });
}

export function useSupplierPurchasesQuery(supplierId: number | null) {
  return useQuery({
    queryKey: SUPPLIER_KEYS.purchases(supplierId ?? 0),
    queryFn: () => window.api.suppliers.getPurchases(supplierId!),
    enabled: !!supplierId,
  });
}

export function useCreatePurchaseMutation(supplierId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      supplier_id: number;
      total_usd: number;
      note?: string;
    }) => window.api.suppliers.createPurchase(data),
    onSuccess: () => {
      if (supplierId) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.purchases(supplierId),
        });
      }
    },
  });
}

/**
 * Pay a supplier down / record a supplier paying us, via payment-method legs.
 * Routes cash to the correct drawer; works with zero pending transactions.
 */
export function useSupplierCashflowMutation(
  supplierId: number | null,
  provider: string | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      supplier_id: number;
      direction: "PAY" | "RECEIVE";
      payments: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
      note?: string;
      exchange_rate?: number;
    }) => window.api.suppliers.recordCashflow(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.all });
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.balances });
      queryClient.invalidateQueries({
        queryKey: SUPPLIER_KEYS.productBalances,
      });
      if (supplierId) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.ledger(supplierId),
        });
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.purchases(supplierId),
        });
        if (provider) {
          queryClient.invalidateQueries({
            queryKey: SUPPLIER_KEYS.unsettled(provider),
          });
          queryClient.invalidateQueries({
            queryKey: SUPPLIER_KEYS.allTransactions(provider),
          });
        }
      }
    },
  });
}

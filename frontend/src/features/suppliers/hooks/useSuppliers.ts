import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useApi } from "@liratek/ui";

// ── Shared query keys ─────────────────────────────────────────────────────────
export const SUPPLIER_KEYS = {
  all: ["suppliers"] as const,
  balances: ["supplier-balances"] as const,
  ledger: (id: number) => ["supplier-ledger", id] as const,
  unsettled: (provider: string) => ["supplier-unsettled", provider] as const,
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

export function useUnsettledTransactionsQuery(provider: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.unsettled(provider ?? ""),
    queryFn: () => (api as unknown as { getUnsettledTransactions: (p: string) => Promise<unknown[]> }).getUnsettledTransactions(provider!),
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

export function useSettleTransactionsMutation(
  supplierId: number | null,
  provider: string | null,
) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      supplier_id: number;
      financial_service_ids: number[];
      amount_usd: number;
      amount_lbp: number;
      commission_usd: number;
      commission_lbp: number;
      drawer_name: string;
      note?: string;
      payments?: Array<{ method: string; currency_code: string; amount: number }>;
    }) =>
      (
        api as unknown as {
          settleTransactions: (d: typeof data) => Promise<{ success: boolean; error?: string }>;
        }
      ).settleTransactions(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.all });
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.balances });
      if (supplierId) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.ledger(supplierId),
        });
        if (provider) {
          queryClient.invalidateQueries({
            queryKey: SUPPLIER_KEYS.unsettled(provider),
          });
        }
      }
    },
  });
}

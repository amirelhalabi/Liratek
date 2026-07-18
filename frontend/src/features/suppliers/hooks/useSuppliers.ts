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
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.productBalances,
    queryFn: () => api.getSupplierProductBalances(),
  });
}

export function useProductItemsQuery(supplierId: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.productItems(supplierId ?? 0),
    queryFn: () => api.getSupplierProductItems(supplierId!),
    enabled: !!supplierId,
  });
}

/** A pending (not-yet-settled) financial_services row eligible for the
 *  batch-settle flow — the SAME row shape/eligibility `getUnsettledByProvider`
 *  has always used (RECEIVE rows with commission > 0, plus cost-flow SEND
 *  rows booked as supplier debt). Deliberately NOT the same set as the
 *  Transactions tab's `allTxns` (settlement_id IS NULL) — that includes row
 *  types (e.g. a plain SEND with no cost/commission) this list has never
 *  considered "settleable". */
export interface UnsettledSupplierTransaction {
  id: number;
  service_type: "SEND" | "RECEIVE";
  amount: number;
  currency: string;
  commission: number;
  omt_fee: number | null;
  omt_service_type: string | null;
  client_name: string | null;
  created_at: string;
}

export function useUnsettledTransactionsQuery(provider: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.unsettled(provider ?? ""),
    queryFn: () =>
      (
        api as unknown as {
          getUnsettledTransactions: (
            p: string,
          ) => Promise<UnsettledSupplierTransaction[]>;
        }
      ).getUnsettledTransactions(provider!),
    enabled: !!provider,
    select: (data) => data ?? [],
  });
}

export function useAllTransactionsQuery(provider: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.allTransactions(provider ?? ""),
    queryFn: () => api.getAllSupplierTransactions(provider!),
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
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.purchases(supplierId ?? 0),
    queryFn: () => api.getSupplierPurchases(supplierId!),
    enabled: !!supplierId,
  });
}

export function useCreatePurchaseMutation(supplierId: number | null) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      supplier_id: number;
      total_usd: number;
      note?: string;
    }) => api.createSupplierPurchase(data),
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
  const api = useApi();
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
      /** CQ-10: bundled discount — PAY direction only. */
      discount?: { amount_usd: number; amount_lbp: number; reason?: string };
    }) => api.recordSupplierCashflow(data),
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

/**
 * Standalone supplier write-off (CQ-10, admin-only) — the supplier forgives
 * what we owe them; pure ledger forgiveness, no cash movement.
 */
export function useSupplierWriteOffMutation(supplierId: number | null) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      supplier_id: number;
      amount_usd: number;
      amount_lbp: number;
      reason?: string;
    }) => api.supplierWriteOff(data),
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
      }
    },
  });
}

/**
 * D5 — batch-settle a set of pending financial_services rows with a
 * supplier (admin-only on both transports). Mirrors the shape the orphaned
 * `Settings/SupplierLedger.tsx` posted before it was resurrected here: net
 * amount = total owed (amount + commission on RECEIVE rows) minus the
 * commission the shop already earned. `supplierSettleSchema` has NO discount
 * field — a batch settle is cash/commission only, never bundled with a
 * forgiveness row.
 */
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
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
    }) => api.settleTransactions(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.all });
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.balances });
      if (supplierId) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.ledger(supplierId),
        });
      }
      if (provider) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.unsettled(provider),
        });
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.allTransactions(provider),
        });
      }
    },
  });
}

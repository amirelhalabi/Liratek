import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@liratek/ui";

// ── OMT open-credit account types (LIRA-187/188) ───────────────────────────
//
// Imported from `@liratek/ui` (re-exported here so every existing consumer
// in this feature can keep importing them from this hooks file) rather than
// hand-copied: `packages/ui/src/api/types.ts` already mirrors
// `SupplierRepository`'s (`packages/core`) `AccountBalance` /
// `AccountChildBalance` / `AccountLedgerEntry` / `AccountUnsettledRow`
// verbatim (rule 14) and its barrel (`packages/ui/src/api/index.ts`)
// re-exports all four — a THIRD hand-typed copy here had already drifted
// (this file used to declare `AccountUnsettledRow.commission_usd`/
// `commission_lbp` as optional/nullable; core populates them unconditionally
// — see that field's doc comment on `SupplierRepository.AccountUnsettledRow`
// for why a caller never needs an `?? 0` guard on it).
import type {
  AccountBalance,
  AccountChildBalance,
  AccountLedgerEntry,
  AccountUnsettledRow,
} from "@liratek/ui";
export type {
  AccountBalance,
  AccountChildBalance,
  AccountLedgerEntry,
  AccountUnsettledRow,
};

// ── Shared query keys ─────────────────────────────────────────────────────────
export const SUPPLIER_KEYS = {
  all: ["suppliers"] as const,
  balances: ["supplier-balances"] as const,
  productBalances: ["supplier-product-balances"] as const,
  productItems: (id: number) => ["supplier-product-items", id] as const,
  // SUPPLIER_STOCK_INTAKE_PLAN.md D9 — event-based inventory VALUE, not
  // debt (see useProductStockValueQuery's own doc comment). Global, not
  // per-supplier: getProductStockValue returns every supplier's figure in
  // one call, same shape as productBalances above.
  productStockValue: ["supplier-product-stock-value"] as const,
  ledger: (id: number) => ["supplier-ledger", id] as const,
  unsettled: (provider: string) => ["supplier-unsettled", provider] as const,
  allTransactions: (provider: string) =>
    ["supplier-all-transactions", provider] as const,
  purchases: (id: number) => ["supplier-purchases", id] as const,
  // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the OMT open-credit
  // account rollup: one balances read (every account, parent+children
  // summed) plus per-account ledger/unsettled reads keyed by the account
  // parent's supplier id.
  accountBalances: ["supplier-account-balances"] as const,
  accountLedger: (accountSupplierId: number) =>
    ["supplier-account-ledger", accountSupplierId] as const,
  accountUnsettled: (accountSupplierId: number) =>
    ["supplier-account-unsettled", accountSupplierId] as const,
};

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — every mutation below that
 * changes a `supplier_ledger` row already invalidates `SUPPLIER_KEYS.all`/
 * `.balances`/`.ledger(id)` for the SINGLE supplier it acted on; NONE of
 * them knew about the account rollup reads before this ticket, so the
 * account card/merged ledger could show a stale total right after e.g.
 * paying down iPick directly. One shared invalidator (rule 14 — a single
 * definition, reused by every mutation here) instead of four separate,
 * drifting copies. `accountLedger`/`accountUnsettled` are invalidated by
 * KEY PREFIX (no specific parent id needed — the mutation only knows the
 * child's own id/provider, not which account it belongs to) since
 * TanStack Query matches a partial query key as a prefix by default.
 */
function invalidateAccountQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.accountBalances });
  queryClient.invalidateQueries({ queryKey: ["supplier-account-ledger"] });
  queryClient.invalidateQueries({ queryKey: ["supplier-account-unsettled"] });
}

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

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — every account's rolled-up
 * balance (parent + children summed, per currency), one read for the whole
 * Companies tab. Empty array on a tenant with no account parent (e.g. no
 * 'OMT' supplier) — the page then renders every supplier as a plain tile,
 * unchanged.
 */
export function useSupplierAccountBalancesQuery() {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.accountBalances,
    queryFn: () => api.getSupplierAccountBalances() as Promise<
      AccountBalance[]
    >,
  });
}

/** @see useSupplierAccountBalancesQuery — the account's merged ledger
 *  (parent + children), fed to the Type column when the selected supplier
 *  IS an account parent. Disabled (no fetch) when there's no parent id. */
export function useSupplierAccountLedgerQuery(
  accountSupplierId: number | null,
  limit?: number,
) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.accountLedger(accountSupplierId ?? 0),
    queryFn: () =>
      api.getSupplierAccountLedger(accountSupplierId!, limit) as Promise<
        AccountLedgerEntry[]
      >,
    enabled: !!accountSupplierId,
  });
}

/** @see useSupplierAccountBalancesQuery — the account's unioned unsettled
 *  queue, used only to derive a per-child unsettled COUNT on the account
 *  card's sub-rows (read-only in this wave; account settlement is
 *  LIRA-189). Disabled (no fetch) when there's no parent id. */
export function useSupplierAccountUnsettledQuery(
  accountSupplierId: number | null,
) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.accountUnsettled(accountSupplierId ?? 0),
    queryFn: () =>
      api.getSupplierAccountUnsettled(accountSupplierId!) as Promise<
        AccountUnsettledRow[]
      >,
    enabled: !!accountSupplierId,
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

/**
 * SUPPLIER_STOCK_INTAKE_PLAN.md D9 — event-based product-supplier stock
 * VALUE: SUM(quantity_remaining × unit_cost_usd) over open cost batches,
 * per supplier. This is INVENTORY VALUE, not debt — do not feed it into
 * any owed/balance figure. Debt is (and only is) the ledger sum
 * (`useProductSupplierBalancesQuery` above); this is a separate,
 * purely-informational "stock on hand" read for the Purchases tab.
 */
export function useProductStockValueQuery() {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.productStockValue,
    queryFn: () => api.getSupplierProductStockValue(),
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
  // COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 — iPick/Katsh BILL rows now
  // join this queue (they used to be born-settled and invisible here).
  service_type: "SEND" | "RECEIVE" | "BILL";
  amount: number;
  currency: string;
  commission: number;
  omt_fee: number | null;
  omt_service_type: string | null;
  client_name: string | null;
  /**
   * Repository-computed owed-per-row (SUPPLIER_OWED_EXPR): the Settle tab
   * sums THIS (net you pay = Σ supplier_owed − Σ commission) — never
   * re-derives owed from amount/fee/commission locally.
   */
  supplier_owed: number;
  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D3 — 0 = LEGACY (EMBEDDED, byte-for-byte
   * unchanged UI), 1 = NEW-MODEL (AT_SETTLEMENT, commission entered here).
   * A selection spanning both values is a hard-reject on the backend (D4) —
   * the Settle tab groups by this field to warn/disable BEFORE submit.
   */
  commission_model: number;
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
      invalidateAccountQueries(queryClient);
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
      invalidateAccountQueries(queryClient);
    },
  });
}

/**
 * LIRA-080 — post a manual supplier_ledger entry (the paper/no-cash side of the
 * Suppliers-page "Add Credit / Debt" action). Used only for `entry_type:
 * "ADJUSTMENT"` with NO drawer_name, so the core writes ONE paper
 * SUPPLIER_ADJUSTMENT transaction with no drawer/payments. The cash-moved side
 * of that action goes through `useSupplierCashflowMutation` instead.
 */
export function useSupplierLedgerEntryMutation(
  supplierId: number | null,
  provider: string | null,
) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      supplier_id: number;
      entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
      amount_usd: number;
      amount_lbp: number;
      note?: string;
    }) => {
      const { supplier_id, ...rest } = data;
      return api.addSupplierLedgerEntry(supplier_id, rest);
    },
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
        if (provider) {
          queryClient.invalidateQueries({
            queryKey: SUPPLIER_KEYS.allTransactions(provider),
          });
        }
      }
      invalidateAccountQueries(queryClient);
    },
  });
}

// NOTE: the standalone supplier write-off mutation (CQ-10) was REMOVED
// (SUPPLIER_STOCK_INTAKE_PLAN.md owner decision D8) — `api.supplierWriteOff`
// no longer exists on either transport. The bundled Pay-form discount
// (`useSupplierCashflowMutation`'s `discount` field above) is the only
// surviving forgiveness path. Do not resurrect this mutation.

/**
 * D5 — batch-settle a set of pending financial_services rows with a
 * supplier (admin-only on both transports).
 *
 * `supplier_owed` per row is `SUPPLIER_OWED_EXPR`, gated per row on
 * `commission_model` (primary-cash-drawer model, 2026-07-30; superseded the
 * 2026-07-29 float model's fee-only design — FEATURE_GUIDE.md §8): a LEGACY
 * row is fee-only (`|fee| − |commission|`, already net of the shop's cut),
 * a NEW-MODEL row is GROSS (commission settles separately). Either way,
 * `amount_usd`/`amount_lbp` sent here is simply the SUM of the outstanding
 * `supplier_owed` across the selection — see Suppliers/index.tsx's
 * `settleNetPayUsd` for exactly where the legacy-vs-new-model split in that
 * sum's *meaning* is handled; this hook only forwards whatever the caller
 * computed. `commission_usd`/`commission_lbp` are informational/audit only
 * for a legacy batch — no drawer effect; for a new-model batch they are the
 * real, money-bearing entered commission (D8). `supplierSettleSchema` has
 * NO discount field — a batch settle is cash/commission only, never
 * bundled with a forgiveness row.
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
      // COMMISSION_AT_SETTLEMENT_PLAN.md D8 — entry mode + audit snapshot of
      // the rate/count used for a new-model (commission_model=1) batch.
      // Ignored for a legacy batch.
      entry_mode?: "LUMP" | "RATE";
      commission_rate?: number;
      commission_unit_count?: number;
      /** Owner follow-up (2026-08-13) — bills-only batch only: 'TOP_UP'
       *  (default) credits the provider's own drawer, 'OTHER_PAYMENT' means
       *  `payments` below carries the real collection legs instead. See
       *  SupplierRepository.SettleTransactionsData for the full contract. */
      commission_collection_mode?: "TOP_UP" | "OTHER_PAYMENT";
      /** @deprecated no longer used to move money — see SupplierRepository.SettleTransactionsData */
      drawer_name?: string;
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
      invalidateAccountQueries(queryClient);
    },
  });
}

// ── OMT open-credit account settlement (LIRA-189, wave 2) ──────────────────

/**
 * Wire shape sent to `settleSupplierAccount` — mirrors `SettleAccountData`
 * (`packages/core/src/repositories/SupplierRepository.ts`) verbatim (rule
 * 14: one shape, not re-derived per layer) MINUS `account_supplier_id`
 * (passed as this hook's own argument, matching the adapter signature
 * `settleSupplierAccount(accountSupplierId, data)`, §2.2) and MINUS
 * `created_by` (never sent by the client — every existing settle/cashflow
 * mutation in this file omits it too; the handler/route injects the actor
 * from the session/JWT, rule 19c).
 */
export interface SettleAccountRequest {
  direction: "PAY" | "COLLECT";
  selections: Array<{ kind: "FINANCIAL_SERVICE" | "LEDGER"; id: number }>;
  amount_usd: number;
  amount_lbp: number;
  commission_usd: number;
  commission_lbp: number;
  entry_mode?: "LUMP" | "RATE";
  commission_rate?: number;
  commission_unit_count?: number;
  note?: string;
  exchange_rate?: number;
  payments?: Array<{
    method: string;
    currency_code: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>;
}

export interface SettleAccountResult {
  success: boolean;
  id?: number;
  error?: string;
}

/**
 * Settle the whole OMT open-credit account (counter + OMT App + iPick) in
 * ONE call (rule 16 — the caller never makes a follow-up call for the
 * payment legs). Admin-only on both transports.
 *
 * `settleSupplierAccount` is called through a defensive cast rather than a
 * plain `api.settleSupplierAccount(...)` call: lane W4 (shared transport
 * plumbing) adds this method to `ApiAdapter` in parallel with this lane, and
 * this file must compile — and its own jest tests must be able to mock the
 * method — regardless of which lane's diff lands in the working tree first.
 * Same pattern as `useUnsettledTransactionsQuery`'s `getUnsettledTransactions`
 * cast above. See this lane's CROSS_LANE_REQUESTS: once W4 lands, this cast
 * becomes redundant (harmless) — it is not meant to be a permanent shape.
 */
export function useSettleSupplierAccountMutation(
  accountSupplierId: number | null,
) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SettleAccountRequest): Promise<SettleAccountResult> => {
      if (!accountSupplierId) {
        return Promise.reject(
          new Error(
            "useSettleSupplierAccountMutation: accountSupplierId is required",
          ),
        );
      }
      return (
        api as unknown as {
          settleSupplierAccount: (
            accountSupplierId: number,
            data: SettleAccountRequest,
          ) => Promise<SettleAccountResult>;
        }
      ).settleSupplierAccount(accountSupplierId, data);
    },
    onSuccess: () => {
      // The batch can touch any/all of the account's children at once — none
      // of the per-child query keys are known here (only the account parent
      // id is), so invalidate broadly by prefix rather than enumerating
      // children: `["supplier-ledger"]` (every open per-supplier ledger),
      // `["supplier-unsettled"]` and `["supplier-all-transactions"]` (every
      // open per-provider queue/history) match as prefixes of their own
      // parameterized keys (`SUPPLIER_KEYS.ledger(id)` etc.) the same way
      // `invalidateAccountQueries` already relies on for the account reads.
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.all });
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.balances });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-unsettled"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-all-transactions"] });
      invalidateAccountQueries(queryClient);
    },
  });
}

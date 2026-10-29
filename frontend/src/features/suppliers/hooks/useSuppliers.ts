import { useCallback } from "react";
import {
  useQueries,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useApi } from "@liratek/ui";
import { normaliseCoveredTypes, type OmtCoveredType } from "@liratek/core";
import { unwrapIpc } from "@/shared/api/unwrapIpc";
import type {
  SupplierArchiveInput,
  SupplierCashflowPayload,
  SupplierDayRangeInput,
  SupplierLedgerEntryPayload,
  SupplierSettleAccountPayload,
  RemoveAccountCreditPayload,
  SupplierSettleInput,
} from "@liratek/core";

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
  AccountDayDetailRow,
  AccountExpectedStatement,
  AccountLedgerEntry,
  AccountUnsettledRow,
} from "@liratek/ui";
export type {
  AccountDayDetailRow,
  AccountBalance,
  AccountChildBalance,
  AccountExpectedStatement,
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
  // LIRA-343 T033a — an OMT account parent's Transactions window (every
  // member's rows). The range is appended by the hook, after this prefix.
  accountTransactions: (accountSupplierId: number) =>
    ["supplier-account-transactions", accountSupplierId] as const,
  purchases: (id: number) => ["supplier-purchases", id] as const,
  // LIRA-087 (migration v189) — the picker list for stock intake's "attach
  // to a recorded debt" flow.
  openRecordedDebts: (id: number) => ["supplier-recorded-debts", id] as const,
  // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the OMT open-credit
  // account rollup: one balances read (every account, parent+children
  // summed) plus per-account ledger/unsettled reads keyed by the account
  // parent's supplier id.
  accountBalances: ["supplier-account-balances"] as const,
  accountLedger: (accountSupplierId: number) =>
    ["supplier-account-ledger", accountSupplierId] as const,
  accountUnsettled: (accountSupplierId: number) =>
    ["supplier-account-unsettled", accountSupplierId] as const,
  // LIRA-343 — the settle calendar's month read (every account row whose
  // shop day is in the month, settled or not).
  accountMonthRows: (accountSupplierId: number, month: string) =>
    ["supplier-account-month-rows", accountSupplierId, month] as const,
  // LIRA-343 T033 — what is behind one shop day of the settle calendar.
  accountDayDetail: (accountSupplierId: number, day: string) =>
    ["supplier-account-day-detail", accountSupplierId, day] as const,
  // LIRA-255 — "check against OMT's statement" panel.
  accountExpectedStatement: (accountSupplierId: number) =>
    ["supplier-account-expected-statement", accountSupplierId] as const,
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
  // LIRA-343 — the settle calendar repaints after any account change.
  queryClient.invalidateQueries({ queryKey: ["supplier-account-month-rows"] });
  queryClient.invalidateQueries({ queryKey: ["supplier-account-day-detail"] });
  queryClient.invalidateQueries({
    queryKey: ["supplier-account-transactions"],
  });
  // LIRA-255 — the statement panel's gross/commission figures derive from
  // the same two sources the lines above already invalidate.
  queryClient.invalidateQueries({
    queryKey: ["supplier-account-expected-statement"],
  });
}

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) follow-up — exposes
 * `invalidateAccountQueries` to callers OUTSIDE this file's own mutations.
 *
 * The Suppliers page's manual Refresh button predates LIRA-188 and, exactly
 * like `unsettledQuery` before it (see the comment beside that button in
 * `Suppliers/index.tsx`), was never taught about a query added later —
 * `accountBalancesQuery`/`accountLedgerQuery` (page-level) and every
 * `SupplierAccountCard`/`AccountSettleSheet` instance's own
 * `useSupplierAccountUnsettledQuery` (component-level, not reachable from
 * the page's Refresh handler at all) kept showing stale data after a click.
 * Routing Refresh through this SAME helper the write-path mutations already
 * use (rule 14 — one definition) means a future fourth account read is
 * covered the moment it's added to `invalidateAccountQueries`, with nothing
 * else to remember to wire up.
 *
 * This does not close the underlying gap by itself: anything that changes
 * supplier/account data WITHOUT going through this file's mutations — a
 * top-up made from Recharge, an OMT SEND from Services — still leaves the
 * account card stale until the user clicks Refresh (or the 30s app-wide
 * `staleTime` lapses and something remounts/refetches the query). Any such
 * flow should call this hook too, rather than re-deriving the three account
 * query keys a third time.
 */
export function useRefreshSupplierAccountQueries(): () => void {
  const queryClient = useQueryClient();
  return useCallback(
    () => invalidateAccountQueries(queryClient),
    [queryClient],
  );
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
    queryFn: () =>
      api.getSupplierAccountBalances() as Promise<AccountBalance[]>,
  });
}

/** @see useSupplierAccountBalancesQuery — the account's merged ledger
 *  (parent + children), fed to the Type column when the selected supplier
 *  IS an account parent. Disabled (no fetch) when there's no parent id. */
export function useSupplierAccountLedgerQuery(
  accountSupplierId: number | null,
  limit?: number,
  /** LIRA-343 T033a — optional shop-day range (`""` = open end), applied
   *  on the server; part of the query key. */
  range?: SupplierDayRangeInput,
) {
  const api = useApi();
  return useQuery({
    queryKey: [
      ...SUPPLIER_KEYS.accountLedger(accountSupplierId ?? 0),
      range?.from ?? "",
      range?.to ?? "",
    ],
    queryFn: () =>
      (range
        ? api.getSupplierAccountLedger(accountSupplierId!, limit, range)
        : api.getSupplierAccountLedger(accountSupplierId!, limit)) as Promise<
        AccountLedgerEntry[]
      >,
    enabled: !!accountSupplierId,
  });
}

/** @see useSupplierAccountBalancesQuery — the account's unioned unsettled
 *  queue, used both to derive a per-child unsettled COUNT on the account
 *  card's sub-rows (read-only) AND to feed `AccountSettleSheet`'s row list
 *  (LIRA-189).
 *
 * `refetchOnMount` defaults to the TanStack default (`true` — serves the
 * cached value if it's within `staleTime`, no network round trip) which is
 * fine for the card's lightweight count display. `AccountSettleSheet`
 * passes `"always"`: this hook's cache entry is SHARED with the account
 * card (same query key), which typically stays mounted continuously while
 * the Suppliers page is open, so ANYTHING that changes the account's
 * unsettled rows through a channel other than this file's OWN mutations —
 * a top-up from Recharge, an OMT SEND from Services, cross-tab activity —
 * leaves the cache "fresh" (not stale, so no auto-refetch) for the rest of
 * the 30s app-wide `staleTime`, even though the real queue changed
 * moments ago (see `useRefreshSupplierAccountQueries`'s own doc comment
 * for the general shape of this gap). A settle sheet deciding how much
 * money changes hands must never silently work off that stale snapshot —
 * unlike the count display, being one field briefly behind is a real
 * money-safety risk here, not a cosmetic one — so it forces a fresh fetch
 * every time it opens, regardless of `staleTime`. Disabled (no fetch) when
 * there's no parent id. */
export function useSupplierAccountUnsettledQuery(
  accountSupplierId: number | null,
  options?: { refetchOnMount?: boolean | "always" },
) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.accountUnsettled(accountSupplierId ?? 0),
    queryFn: () =>
      api.getSupplierAccountUnsettled(accountSupplierId!) as Promise<
        AccountUnsettledRow[]
      >,
    enabled: !!accountSupplierId,
    refetchOnMount: options?.refetchOnMount ?? true,
  });
}

/**
 * LIRA-343 — every row of the account whose shop day falls in `month`
 * (`YYYY-MM`), settled or not: the settle calendar's month view. Read-only
 * (the money the sheet moves is decided from the open queue above, never
 * from this read). Rule 25: `api` never enters a dependency list or the
 * query key — the query function only closes over it, like every sibling
 * hook here (a ref read inside `queryFn` is refused by react-hooks/refs).
 * Disabled when there is no parent id.
 */
export function useSupplierAccountMonthRowsQuery(
  accountSupplierId: number | null,
  month: string,
) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.accountMonthRows(accountSupplierId ?? 0, month),
    queryFn: () => api.getSupplierAccountMonthRows(accountSupplierId!, month),
    enabled: !!accountSupplierId,
  });
}

/**
 * "See transactions" (owner mock 2026-10-26) — the month rows of SEVERAL
 * months at once (every month that has a picked day), on the SAME query keys
 * as {@link useSupplierAccountMonthRowsQuery}, so a month the calendar
 * already read is served from that cache. Read-only; off until `enabled`
 * (the table is open). Same rule-25 shape as the hooks around it.
 */
export function useSupplierAccountMonthsRowsQueries(
  accountSupplierId: number | null,
  months: readonly string[],
  enabled: boolean,
) {
  const api = useApi();
  return useQueries({
    queries: months.map((month) => ({
      queryKey: SUPPLIER_KEYS.accountMonthRows(accountSupplierId ?? 0, month),
      queryFn: () => api.getSupplierAccountMonthRows(accountSupplierId!, month),
      enabled: enabled && !!accountSupplierId,
    })),
  });
}

/**
 * LIRA-343 T033 (FR-016) — what is behind one shop day (`YYYY-MM-DD`) of
 * the account: its rows, who paid each one, and the "added after
 * settlement" tag. Read-only. Disabled while no day is open (`day` null) or
 * there is no parent id. Same rule-25 shape as the month hook above.
 */
export function useSupplierAccountDayDetailQuery(
  accountSupplierId: number | null,
  day: string | null,
) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.accountDayDetail(accountSupplierId ?? 0, day ?? ""),
    queryFn: () => api.getSupplierAccountDayDetail(accountSupplierId!, day!),
    enabled: !!accountSupplierId && !!day,
  });
}

/**
 * LIRA-255 — "check against OMT's statement" panel: gross owed minus
 * unsettled commission, in OMT's own sign convention. Display-only (no
 * money moves from this read), so the app-wide default `staleTime` is
 * fine — unlike `useSupplierAccountUnsettledQuery`'s settle-sheet
 * `"always"` override, nothing here decides how much cash changes hands.
 * Disabled (no fetch) when there's no parent id.
 */
export function useSupplierAccountExpectedStatementQuery(
  accountSupplierId: number | null,
  /** LIRA-256 — covered OMT commission types; undefined = all types. */
  coveredTypes?: OmtCoveredType[],
  /** 2026-10-27 — the shop's day (YYYY-MM-DD, the browser's, rule 27) OMT's
   *  SMS covers, inclusive; undefined = every open row. */
  upToDay?: string,
) {
  const api = useApi();
  return useQuery({
    // Prefix stays `accountExpectedStatement(id)` so invalidateAccountQueries'
    // prefix match still refreshes every choice's cached figure.
    queryKey: [
      ...SUPPLIER_KEYS.accountExpectedStatement(accountSupplierId ?? 0),
      coveredTypes ? normaliseCoveredTypes(coveredTypes).join(",") : "ALL",
      upToDay ?? "ALL_DAYS",
    ],
    queryFn: () =>
      api.getSupplierAccountExpectedStatement(
        accountSupplierId!,
        coveredTypes,
        upToDay,
      ) as Promise<AccountExpectedStatement>,
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

/** The supplier Transactions window's history. LIRA-343 T033a: an
 *  optional shop-day range (`""` = open end), applied on the server before
 *  the row limit; part of the query key (after the provider prefix, so
 *  `SUPPLIER_KEYS.allTransactions(provider)` still invalidates every range). */
export function useAllTransactionsQuery(
  provider: string | null,
  range?: SupplierDayRangeInput,
) {
  const api = useApi();
  return useQuery({
    queryKey: [
      ...SUPPLIER_KEYS.allTransactions(provider ?? ""),
      range?.from ?? "",
      range?.to ?? "",
    ],
    queryFn: () =>
      range
        ? api.getAllSupplierTransactions(provider!, undefined, range)
        : api.getAllSupplierTransactions(provider!),
    enabled: !!provider,
    select: (data) => data ?? [],
  });
}

/** LIRA-343 T033a — an OMT account parent's Transactions window: every
 *  member's rows (OMT, OMT App, iPick), same row shape as
 *  {@link useAllTransactionsQuery}, optional shop-day range. Disabled when
 *  there is no parent id. */
export function useSupplierAccountTransactionsQuery(
  accountSupplierId: number | null,
  range?: SupplierDayRangeInput,
) {
  const api = useApi();
  return useQuery({
    queryKey: [
      ...SUPPLIER_KEYS.accountTransactions(accountSupplierId ?? 0),
      range?.from ?? "",
      range?.to ?? "",
    ],
    queryFn: () =>
      range
        ? api.getSupplierAccountTransactions(
            accountSupplierId!,
            undefined,
            range,
          )
        : api.getSupplierAccountTransactions(accountSupplierId!),
    enabled: !!accountSupplierId,
    select: (data) => data ?? [],
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useAddLedgerEntryMutation(supplierId: number | null) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    // Typed from the core schema (rule 21) — the loose hand-written shape
    // (`entry_type: string`, optional amounts) accepted payloads both
    // transports' supplierLedgerEntrySchema rejects.
    mutationFn: (payload: SupplierLedgerEntryPayload) =>
      api.addSupplierLedgerEntry(supplierId!, payload),
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

/** LIRA-362 — archive/unarchive a supplier; throws the refusal message. */
export function useSetSupplierArchivedMutation() {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SupplierArchiveInput) =>
      unwrapIpc(api.setSupplierArchived(payload), (r) => r.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.all });
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.balances });
      queryClient.invalidateQueries({
        queryKey: SUPPLIER_KEYS.productBalances,
      });
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

/**
 * LIRA-087 (migration v189) — open (unattached) 'RECORDED_DEBT' rows for one
 * supplier, used by the stock-intake form's "attach to a recorded debt"
 * picker.
 */
export function useOpenRecordedDebtsQuery(supplierId: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: SUPPLIER_KEYS.openRecordedDebts(supplierId ?? 0),
    queryFn: () => api.getOpenRecordedSupplierDebts(supplierId!),
    enabled: !!supplierId,
    select: (data) => data ?? [],
  });
}

/** LIRA-087 — record a supplier debt without a product line yet. */
export function useRecordSupplierDebtMutation(supplierId: number | null) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      supplier_id: number;
      amount_usd: number;
      amount_lbp: number;
      note?: string | null;
    }) => api.recordSupplierDebt(data),
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
          queryKey: SUPPLIER_KEYS.openRecordedDebts(supplierId),
        });
      }
    },
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
    // LIRA-313 (rule 21) — the core schema's input type: the hand-written
    // copy lacked the per-leg `direction` that marks change handed back.
    mutationFn: (data: SupplierCashflowPayload) =>
      api.recordSupplierCashflow(data),
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
    mutationFn: (data: SupplierLedgerEntryPayload) => {
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
 * `commission_model` (FEATURE_GUIDE.md §8.1): a LEGACY row (0) is read
 * netted — principal + fee − commission, already net of the shop's cut — and
 * a NEW-MODEL row (1) is GROSS — principal + fee, with the commission entered
 * at settlement (LUMP or RATE × count) and booked then. Either way,
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
    // Payload derived from the core supplierSettleSchema (rule 21).
    mutationFn: (data: SupplierSettleInput) => api.settleTransactions(data),
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
 * Wire shape sent to `settleSupplierAccount` — LIRA-322 (rules 21/22): the
 * core schema's input type (`SupplierSettleAccountPayload` =
 * `z.input<typeof supplierSettleAccountSchema>`), never a hand-copied
 * literal, MINUS `account_supplier_id` (passed as this hook's own argument,
 * matching the adapter signature `settleSupplierAccount(accountSupplierId,
 * data)`). `created_by` is not part of the schema: the handler/route injects
 * the actor from the session/JWT (rule 19c).
 */
export type SettleAccountRequest = Omit<
  SupplierSettleAccountPayload,
  "account_supplier_id"
>;

export interface SettleAccountResult {
  success: boolean;
  id?: number;
  error?: string;
}

/**
 * Settle the whole OMT open-credit account (counter + OMT App + iPick) in
 * ONE call (rule 16 — the caller never makes a follow-up call for the
 * payment legs). Admin-only on both transports.
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
      return api.settleSupplierAccount(accountSupplierId, data);
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
      // LIRA-345 — a product supplier settles here too.
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.productBalances });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-unsettled"] });
      queryClient.invalidateQueries({
        queryKey: ["supplier-all-transactions"],
      });
      invalidateAccountQueries(queryClient);
    },
  });
}

// ── LIRA-344 — Remove credit on the OMT account ─────────────────────────────

/** Wire shape for `removeSupplierAccountCredit` — the core schema's input
 *  (rule 21) minus `account_supplier_id` (this hook's own argument). The
 *  actor is injected server-side (rule 19c). */
export type RemoveAccountCreditRequest = Omit<
  RemoveAccountCreditPayload,
  "account_supplier_id"
>;

export interface RemoveAccountCreditResult {
  success: boolean;
  id?: number;
  transaction_id?: number;
  expense_id?: number;
  error?: string;
}

/**
 * Close one open OMT account credit OMT will not accept and book it as an
 * expense (no drawer). Admin only on both transports. Refreshes the same
 * account reads a settlement does, so the sheet's credit line updates.
 */
export function useRemoveSupplierAccountCreditMutation(
  accountSupplierId: number | null,
) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (
      data: RemoveAccountCreditRequest,
    ): Promise<RemoveAccountCreditResult> => {
      if (!accountSupplierId) {
        return Promise.reject(
          new Error(
            "useRemoveSupplierAccountCreditMutation: accountSupplierId is required",
          ),
        );
      }
      return api.removeSupplierAccountCredit(accountSupplierId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.all });
      queryClient.invalidateQueries({ queryKey: SUPPLIER_KEYS.balances });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-unsettled"] });
      queryClient.invalidateQueries({
        queryKey: ["supplier-all-transactions"],
      });
      invalidateAccountQueries(queryClient);
    },
  });
}

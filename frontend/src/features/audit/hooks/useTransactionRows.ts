import { useCallback, useEffect, useMemo, useState } from "react";
import { useCursorPages, type CursorPage } from "@liratek/ui";
import {
  DEFAULT_HIDDEN_TRANSACTION_TYPES,
  buildTransactionListFilters,
  isTransactionListRowVisible,
  summaryGroupKeyOf,
  localDayOfUtcTimestamp,
  type TransactionPageCursor,
} from "@liratek/core";
import {
  getRecentTransactions,
  type TransactionFiltersParam,
} from "@/api/backendApi";
import { isSessionItemRefundRow, selectedListOptions } from "../auditConstants";
import logger from "@/utils/logger";
import type { TransactionPaymentLeg } from "../cashFlow";

/** One element of `TransactionFiltersParam.typeFilters` — derived from the
 *  adapter's own type rather than hand-written, so it can never drift from
 *  what the REST route/repository actually accept (rule 21). */
type TypeFilterTuple = NonNullable<
  TransactionFiltersParam["typeFilters"]
>[number];

/**
 * Loading, filtering and window-widening for the transactions table.
 *
 * Extracted from `TransactionsViewer` (which is a presentation component and
 * had no business owning a pagination algorithm): the widening fetch loop
 * below is real data-layer logic with an edge case worth testing —
 * under-filled windows, exhausted tables, the fetch cap — and while it lived
 * inside a `useCallback` in the page it could only be exercised by rendering
 * the whole table. It now has its own unit test.
 *
 * Everything here is transport-agnostic: `getRecentTransactions` is the
 * dual-mode adapter, so this hook works identically on desktop (IPC) and web
 * (REST).
 */

/** A row as the transactions table receives it. */
export type TransactionRow = {
  id: number;
  type: string;
  status: string;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd: number;
  amount_lbp: number;
  exchange_rate: number | null;
  /** The rate to SHOW ("@ rate"): a session member's basket checkout rate,
   *  else `exchange_rate` (core `DISPLAY_EXCHANGE_RATE_SQL`). Optional for
   *  rows from an older backend. */
  display_exchange_rate?: number | null;
  client_id: number | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
  username: string;
  client_name: string | null;
  /** The customer's phone as saved on the row (LIRA-329); `getRecent`
   *  already selects it. Optional for rows from an older backend. */
  client_phone?: string | null;
  // WS8: set when the row belongs to a customer-session basket. Drives the
  // per-session colored left-border accent. Null for non-session rows.
  session_id: number | null;
  /** Server-computed: this row (or its session basket) is linked to a
   *  customer account in `debt_ledger` — what the Debts filter options also
   *  show. Optional for rows from an older backend (reads as not linked). */
  paid_via_account?: boolean;
  /** Server-computed (LIRA-339): this row (or its session basket) was paid
   *  with a voucher — what the Vouchers filter options also show. Optional
   *  for rows from an older backend (reads as not paid with a voucher). */
  paid_via_voucher?: boolean;
  // note 21d: the ACTIVE REFUND row's id that reverses THIS row, or null.
  // The original row stays status=ACTIVE/reverses_id=null after a refund
  // (deliberate — see TransactionRepository), so this is the ONLY signal
  // that tells the UI "already refunded" without the REFUND row itself
  // being loaded on the same page/filter. See actionGating.ts.
  reversed_by_id?: number | null;
  // LIRA-064: structured payment breakdown (may be absent on legacy rows).
  // ALWAYS this row's own legs only (LIRA-201b) — never the session
  // basket's pooled legs; see session_payments below for those.
  payments?: TransactionPaymentLeg[];
  // CUSTOMER_ACCOUNT settlement charged directly against THIS transaction
  // (never written to `payments` — see TransactionWithUser in the backend
  // for why). Always absent on a session-basket row — see
  // session_account_payments below for the basket's pooled equivalent.
  account_payments?: TransactionPaymentLeg[];
  /**
   * LIRA-201b (owner note #11-B) — the session basket's pooled cash legs,
   * present on EVERY row of a session that has any (not just whichever
   * member happens to hold its own legs). `TransactionsViewer` reads this to
   * render the pooled in/out and payment detail ONCE, on a single
   * session-group header row picked from the currently visible members
   * (`sessionGroupHeaders.ts`) — every other member's own `payments` stays
   * row-scoped. Never fed into any money computation.
   */
  session_payments?: TransactionPaymentLeg[];
  /** The session-basket analogue of `session_payments`, for the pooled
   *  CUSTOMER_ACCOUNT settlement of the basket (LIRA-201b). */
  session_account_payments?: TransactionPaymentLeg[];
  /** LIRA-319 — the extra charge on this row (`transactions.extra_*`).
   *  Optional for rows from an older backend. */
  extra_usd?: number | null;
  extra_lbp?: number | null;
  /**
   * LIRA-205 — net telecom credit returned to the shop on this transaction
   * (Only-Days sale of an MTC/Alfa card through iPick/Katsh), in USD.
   * Mirrors `TransactionWithUser.returned_credits_usd`
   * (packages/core/src/repositories/TransactionRepository.ts) and
   * `RecentTransaction.returned_credits_usd` (electron.d.ts) end to end.
   *
   * ABSENT (never 0) on every transaction that posted no CREDIT_RETURN leg: a
   * zero on a money column is a claim that credit was returned and it was
   * nothing. Read by `ReturnedCreditsCell` (../components/TransactionCells).
   */
  returned_credits_usd?: number;
  /** LIRA-304 — see `RecentTransaction.drawer_moves` (electron.d.ts). */
  drawer_moves?: Array<{
    from: string;
    to: string;
    currency_code: string;
    amount: number;
  }>;
  /**
   * LIRA-236 follow-up (2026-09-27 review) — server-computed replacement for
   * the old amount-sign `isSessionPayoutMember` heuristic (see
   * `sessionsWithPayoutMember` below): true when THIS row is a session-basket
   * member that was netted as a payout at checkout (a loto cash prize, a
   * wallet/Binance cash-out, a negative-amount custom-service payout). The
   * amount-sign check missed a wallet/Binance cash-out entirely — that
   * member's OWN `transactions` row carries a positive-or-zero amount; only
   * the session's pooled basket-link row ever carried the negative
   * customer-side amount. Optional because core's `getRecent` addition may
   * not have landed yet in every environment this type is compiled against;
   * absent/undefined MUST read as "not a payout" (never hidden), same as a
   * REFUND row's own negative amount must never be misread as one.
   */
  is_session_payout?: boolean;
  /**
   * Coordinator follow-up (2026-09-27), item 5 — true when THIS row belongs
   * to a session basket where EVERY member has already been refunded (item
   * by item, or by an earlier whole-member refund/void) — server-computed,
   * `TransactionRepository.isSessionBasketFullyRefunded`/`getRecent`'s
   * addition, stamped identically onto every row of the session. Optional
   * for the same reason `is_session_payout` above is: absent/undefined MUST
   * read as "not fully refunded" (never hides the basket actions).
   */
  session_fully_refunded?: boolean;
  /**
   * Shop-day 2026-10-16 (core `getRecent`) — on a sale-ITEM refund row: the
   * SALE row it belongs to (such rows keep `reverses_id` null, which means
   * "whole refund"). Read through `reversedTransactionId` (../rowBadges).
   * Optional for rows from an older backend.
   */
  item_refund_of_id?: number | null;
  /** On an active, not-whole-refunded SALE: at least one line was refunded
   *  item by item. The server refuses a whole Void/Refund then. */
  item_refunded?: boolean;
  /** With `item_refunded`: some quantity can still be refunded ("PARTLY
   *  REFUNDED"); false = every line refunded item by item ("REFUNDED",
   *  while `reversed_by_id` stays null). */
  item_refund_remaining?: boolean;
};

/**
 * LIRA-389 — the list's per-row rule (rule-26 auto-row hide, Supplier Credit,
 * Cash only, the multi-select's union) and the request it sends now live in
 * core (`utils/transactionListFilter.ts`), shared with the Summary view so
 * the two can never disagree. `FilterOption` is that option type plus its
 * label, so a selected option is passed to core as it is.
 */
// Transaction types blanket-hidden from the table regardless of any per-row
// metadata: client-activity log noise (CLIENT_CREATED), not useful in the
// operator-facing list by default.
//
// SUPPLIER_PAYMENT used to blanket-hide here too. D2 (CQ-8) replaced that:
// a manual supplier payment is now a first-class visible row and only the
// auto-generated ledger siblings (metadata.is_auto === true) stay hidden by
// default — see isSupplierPaymentVisible (auditConstants.ts), applied
// per-row below since the SQL-level `excludeTypes` can only exclude by
// type, not by metadata. EXPENSE follows the same per-row pattern (see
// isExpenseVisible) for the auto-generated SMS_Transfer_Fee/etc rows.
// Defined once in core, shared with the phone's Activity tab.
export const HIDDEN_TRANSACTION_TYPES = new Set(
  DEFAULT_HIDDEN_TRANSACTION_TYPES,
);

/** Multiplier applied to the requested row count on the first fetch, and
 *  again on every widening pass. */
const WIDEN_FACTOR = 3;
/** Never fetch more than this, however under-filled the window stays. */
const FETCH_CAP = 5000;

export interface UseTransactionRowsParams {
  /** Rows per page (LIRA-348: 50 — the table loads more as it scrolls). */
  limit: string;
  /** Labels of the SELECTED FILTER_GROUPS options — a UNION (OR) of every
   *  one's tuple. Empty array means "All types" (the cleared state). */
  selectedFilters: string[];
  search: string;
  /** Inclusive yyyy-mm-dd days — the operator's own days, sent to the
   *  server as `day_from` / `day_to` (LIRA-348, rule 27). "" = open end. */
  from: string;
  to: string;
  /** LIRA-389 — a Summary row the operator clicked: the list shows only
   *  that row's transactions (on top of the filters above). */
  drill?: TransactionListDrill | undefined;
}

/**
 * LIRA-389 — the drill-down of a clicked Summary row. Module and service-type
 * rows are matched per row with core's `summaryGroupKeyOf` (the summary's own
 * grouping); product and category rows reach SQL as `getRecent` filters.
 */
export type TransactionListDrill =
  | { dimension: "type" | "service"; key: string; label: string }
  | { dimension: "product"; productId: number; label: string }
  | { dimension: "category"; category: string | null; label: string };

export interface UseTransactionRowsResult {
  /** Visible rows for the active filters: every page loaded so far, each
   *  page at most `limit` rows (LIRA-348). */
  rows: TransactionRow[];
  /** `rows` narrowed to the from/to days — what the table renders. The
   *  server already applies the range (LIRA-348); this is a no-op safety
   *  net kept on the same local-day rule. */
  filteredRows: TransactionRow[];
  /** The first page is loading. */
  loading: boolean;
  /** LIRA-348 — a further page is loading / exists / load it. */
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  /** Load every remaining page — the export uses it (LIRA-348). */
  loadAll: () => Promise<void>;
  /** Start over from the first page (after a void/refund writes). */
  reload: () => void;
  /**
   * LIRA-232 round-3 review (finding 3) — session ids that already have AT
   * LEAST ONE per-item refund (a `refundSessionBasketItem` REFUND row,
   * identified by `isSessionItemRefundRow`). Deliberately NOT derived from
   * `rows`/`filteredRows`: both are narrowed by the operator's active
   * type/search selection (SQL-level, in `load` below) and date range
   * (client-side, in `filteredRows`), so a filter that hides the one REFUND
   * row that proves a session was touched would wrongly un-hide "Void
   * basket" — which still hard-refuses server-side no matter what the page
   * currently shows. Populated by a SEPARATE, always-unfiltered-by-page-state
   * REFUND-only query (see `loadSessionsWithItemRefund` below) that never
   * depends on `selectedFilters`/`search`/`from`/`to`.
   */
  sessionsWithItemRefund: Set<number>;
  /**
   * Coordinator follow-up (2026-09-27), item 5 — session ids where EVERY
   * member has already been refunded item by item (server-computed,
   * `TransactionRow.session_fully_refunded`). The server now REFUSES both
   * `voidSessionBasket` and `refundSessionBasket` on such a basket, so
   * `TransactionsViewer` hides BOTH "Void basket" and "Refund basket" for
   * it (`ActionsCell`'s `hideBasketActions`), rather than offering buttons
   * guaranteed to error.
   */
  sessionsFullyRefunded: Set<number>;
}

/** A failed page read would otherwise leave an empty table that only says
 *  "No transactions" — log it (rule 4). */
function logPageError(error: unknown): void {
  logger.error("Failed to load transactions", { error });
}

export function useTransactionRows({
  limit,
  selectedFilters,
  search,
  from,
  to,
  drill,
}: UseTransactionRowsParams): UseTransactionRowsResult {
  // LIRA-232 round-3 review (finding 3) — populated ONLY while a filter is
  // active (see `hasActiveFilter` below); `null` otherwise, meaning "derive
  // it from `rows` instead" (see the `sessionsWithItemRefund` memo at the
  // bottom of this hook).
  const [dedicatedSessionsWithItemRefund, setDedicatedSessionsWithItemRefund] =
    useState<Set<number> | null>(null);

  // A content-derived primitive key, not the array reference itself. Any
  // caller that builds `selectedFilters` fresh per render (an inline `[]` in
  // JSX, say) would otherwise recreate the fetch — and refire the load —
  // every render even though the actual selection hasn't changed
  // (CLAUDE.md rule 25: an unstable *dependency*, not the array type itself,
  // is the hazard). Order-independent, so reordering the same selection is a
  // no-op re-fetch.
  const filterKey = selectedFilters.slice().sort().join("|");
  // Same reason for the drill-down: a content key, not the object.
  const drillKey = drill ? JSON.stringify(drill) : "";

  /**
   * LIRA-348 — ONE page of visible rows, starting after `cursor` (the last
   * row the table already shows, keyset on `created_at DESC, id DESC`).
   *
   * Some filters are client-only (the auto-row hide, Cash only, a mixed
   * typed + untyped selection — see `filterVisible`), so a raw window can
   * come back under-filled. The loop keeps reading the NEXT raw window (3×
   * wider each time, up to FETCH_CAP raw rows per page) until the page has
   * `limit` visible rows or the table is exhausted. Nothing is skipped: when
   * a window holds more visible rows than the page has room for, the page
   * ends at the last row KEPT and the next page resumes right after it.
   */
  const fetchPage = useCallback(
    async (
      cursor: TransactionPageCursor | undefined,
    ): Promise<CursorPage<TransactionRow, TransactionPageCursor>> => {
      const activeOptions = selectedListOptions(selectedFilters);
      // LIRA-389 — the request and the per-row rule come from core, the
      // SAME two functions the Summary view runs on the server
      // (`utils/transactionListFilter.ts`): the multi-select's OR-group as
      // `typeFilters` (omitted when an untyped option such as "Cash only"
      // is mixed in), search, the operator's days (LIRA-348, rule 27) and
      // the always-hidden types excluded in SQL so LIMIT applies to
      // already-filtered rows.
      const filters = {
        ...buildTransactionListFilters(activeOptions, {
          search,
          day_from: from,
          day_to: to,
        }),
        // Product / category drill-down (LIRA-389): SQL-side.
        ...(drill?.dimension === "product"
          ? { sale_product_id: drill.productId }
          : {}),
        ...(drill?.dimension === "category"
          ? { sale_category: drill.category }
          : {}),
      } as TransactionFiltersParam;

      const requested = Number(limit) || 50;

      const filterVisible = (fetched: TransactionRow[]) =>
        fetched.filter(
          (r) =>
            isTransactionListRowVisible(r, activeOptions) &&
            // Module / service-type drill-down (LIRA-389): the SAME key
            // function the summary groups by.
            (drill?.dimension !== "type" && drill?.dimension !== "service"
              ? true
              : summaryGroupKeyOf(r, drill.dimension) === drill.key),
        );

      let fetchSize = requested * WIDEN_FACTOR;
      let fetched = 0;
      let before = cursor;
      const page: TransactionRow[] = [];
      for (;;) {
        const raw = ((await getRecentTransactions(fetchSize, {
          ...filters,
          ...(before ? { before } : {}),
        })) || []) as TransactionRow[];
        fetched += raw.length;
        const visible = filterVisible(raw);
        const room = requested - page.length;
        if (visible.length > room) {
          page.push(...visible.slice(0, room));
          const last = page[page.length - 1];
          return {
            rows: page,
            nextCursor: { created_at: last.created_at, id: last.id },
          };
        }
        page.push(...visible);
        if (raw.length < fetchSize) return { rows: page }; // exhausted
        const last = raw[raw.length - 1];
        before = { created_at: last.created_at, id: last.id };
        if (page.length >= requested || fetched >= FETCH_CAP) {
          return { rows: page, nextCursor: before };
        }
        fetchSize *= WIDEN_FACTOR;
      }
    },
    // `filterKey` (not `selectedFilters`) is the intentional dependency —
    // see the comment on its declaration above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [limit, filterKey, search, from, to, drillKey],
  );

  const pages = useCursorPages(
    fetchPage,
    `${limit}|${filterKey}|${search}|${from}|${to}|${drillKey}`,
    logPageError,
  );
  const rows = pages.rows;
  const loading = pages.loading;

  // LIRA-232 round-3 review (finding 3) — whether ANY active filter could
  // hide the one REFUND row that proves a session was touched by an item
  // refund: an active type selection (SQL-level, in `load` above) or an
  // active date range (client-side, in `filteredRows` below). With no filter
  // at all, `rows` already contains every REFUND row the fetch window
  // covers (REFUND is never in HIDDEN_TRANSACTION_TYPES and "All types"
  // matches every type), so deriving the set from `rows` directly is exactly
  // as correct as a dedicated fetch and costs no extra round trip — the
  // widening-loop tests below rely on `getRecentTransactions` being called
  // exactly once per `load()` in that unfiltered case.
  // LIRA-389: a Summary drill-down narrows the rows too.
  const hasActiveFilter =
    selectedFilters.length > 0 ||
    from !== "" ||
    to !== "" ||
    drill !== undefined;

  // A dedicated, always-unfiltered-by-page-state REFUND-only fetch, run ONLY
  // while `hasActiveFilter` is true. Deliberately has NO dependency on
  // `filterKey`/`search`/`from`/`to`: those narrow what the OPERATOR
  // currently sees, but "has this session already had an item refund" is a
  // fact about the data, not about the current view, and
  // `voidSessionBasket` refuses server-side regardless of the active filter.
  // Best-effort — a failed fetch here must never block the main table; on
  // failure it leaves the previous dedicated set (or null, before the first
  // one lands) rather than throwing, matching the safe default documented on
  // `isSessionItemRefundRow` ("don't hide a button that might still work").
  const loadSessionsWithItemRefund = useCallback(async () => {
    try {
      const raw = ((await getRecentTransactions(FETCH_CAP, {
        typeFilters: [{ type: "REFUND" } as TypeFilterTuple],
      })) || []) as TransactionRow[];
      const ids = new Set<number>();
      for (const row of raw) {
        if (
          row.session_id != null &&
          isSessionItemRefundRow(row.type, row.metadata_json)
        ) {
          ids.add(row.session_id);
        }
      }
      setDedicatedSessionsWithItemRefund(ids);
    } catch {
      // ignore — see doc above
    }
  }, []);

  useEffect(() => {
    if (hasActiveFilter) {
      loadSessionsWithItemRefund();
    } else {
      // Filter cleared — fall back to deriving from `rows` (below) until/
      // unless a filter is applied again.
      setDedicatedSessionsWithItemRefund(null);
    }
  }, [hasActiveFilter, loadSessionsWithItemRefund]);

  // Both queries refresh together after a write (void/refund/etc) — a caller
  // that just voided or item-refunded something needs the table AND the
  // hide-Void-basket set to reflect it. Only re-runs the dedicated fetch
  // while a filter is active, for the same reason the effect above does.
  const reloadPages = pages.reload;
  const reload = useCallback(() => {
    void reloadPages();
    if (hasActiveFilter) loadSessionsWithItemRefund();
  }, [reloadPages, hasActiveFilter, loadSessionsWithItemRefund]);

  const filteredRows = useMemo(() => {
    if (!from && !to) return rows;
    return rows.filter((row) => {
      // The SHOP's local day, not the UTC prefix of created_at (LIRA-289):
      // a 00:30 Beirut sale is stored as 21:30 UTC the day before.
      const dateVal = localDayOfUtcTimestamp(row.created_at ?? "");
      if (from && dateVal < from) return false;
      if (to && dateVal > to) return false;
      return true;
    });
  }, [rows, from, to]);

  // No active filter: `rows` already carries every REFUND row the fetch
  // window covers, so derive straight from it (no extra round trip). With a
  // filter active, prefer the dedicated unfiltered fetch's result — falling
  // back to deriving from `rows` only for the brief window before that
  // fetch's first response lands (same "don't hide a button that might
  // still work" default as everywhere else here).
  const sessionsWithItemRefundFromRows = useMemo(() => {
    const ids = new Set<number>();
    for (const row of rows) {
      if (
        row.session_id != null &&
        isSessionItemRefundRow(row.type, row.metadata_json)
      ) {
        ids.add(row.session_id);
      }
    }
    return ids;
  }, [rows]);
  const sessionsWithItemRefund =
    dedicatedSessionsWithItemRefund ?? sessionsWithItemRefundFromRows;

  // Coordinator follow-up (2026-09-27), item 5 — session ids where EVERY
  // member has already been refunded item by item (server-computed,
  // `TransactionRow.session_fully_refunded` / `TransactionRepository
  // .isSessionBasketFullyRefunded`, stamped identically onto every row of
  // that session by `getRecent()`). Derived from `rows` (the full page-level
  // set), never `filteredRows` (further narrowed by the date range) — since
  // the flag is stamped onto EVERY row of the session identically, any one
  // visible row of that session already carries the correct value, unlike
  // `sessionsWithItemRefund` above (which needs its own dedicated
  // unfiltered query because only ONE specific REFUND row proves "touched").
  const sessionsFullyRefunded = useMemo(() => {
    const ids = new Set<number>();
    for (const row of rows) {
      if (row.session_id != null && row.session_fully_refunded === true) {
        ids.add(row.session_id);
      }
    }
    return ids;
  }, [rows]);

  return {
    rows,
    filteredRows,
    loading,
    isLoadingMore: pages.isLoadingMore,
    hasMore: pages.hasMore,
    loadMore: pages.loadMore,
    loadAll: pages.loadAll,
    reload,
    sessionsWithItemRefund,
    sessionsFullyRefunded,
  };
}

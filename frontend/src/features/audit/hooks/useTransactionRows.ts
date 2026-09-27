import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getRecentTransactions,
  type TransactionFiltersParam,
} from "@/api/backendApi";
import {
  ALL_FILTER_OPTIONS,
  parseMetaSafe,
  isExpenseVisible,
  isSupplierPaymentVisible,
  isSessionItemRefundRow,
  type FilterOption,
} from "../auditConstants";
import { isCashTransaction, extraCurrencyLegs } from "../cashFlow";
import type { TransactionPaymentLeg } from "../cashFlow";

/** One element of `TransactionFiltersParam.typeFilters` — derived from the
 *  adapter's own type rather than hand-written, so it can never drift from
 *  what the REST route/repository actually accept (rule 21). */
type TypeFilterTuple = NonNullable<TransactionFiltersParam["typeFilters"]>[number];

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
  client_id: number | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
  username: string;
  client_name: string | null;
  // WS8: set when the row belongs to a customer-session basket. Drives the
  // per-session colored left-border accent. Null for non-session rows.
  session_id: number | null;
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
};

/**
 * Whether ONE row's type/provider/service_type/item_key structurally
 * matches ONE FILTER_GROUPS option's tuple. Mirrors the SQL predicate
 * `TransactionRepository.getRecent`'s `buildTypeTupleConditions` builds — a
 * client-side twin is needed because a MIXED multi-selection (a typed option
 * alongside an untyped one, e.g. "Cash only (till)") disables the SQL-level
 * type restriction entirely (see `typeTuples` in `load` below, and the
 * comment on why), so the exact tuple has to be re-checked here per row
 * instead of trusted straight from the fetch.
 */
function matchesTypeTuple(row: TransactionRow, option: FilterOption): boolean {
  if (!option.type) return true;
  if (option.type !== row.type) return false;
  const meta = parseMetaSafe(row.metadata_json);
  if (option.provider !== undefined && meta.provider !== option.provider) {
    return false;
  }
  if (
    option.service_type !== undefined &&
    meta.service_type !== option.service_type
  ) {
    return false;
  }
  if (option.has_item_key === true && meta.item_key == null) return false;
  if (option.has_item_key === false && meta.item_key != null) return false;
  return true;
}

/**
 * Whether ONE row should be visible under ONE selected filter option — every
 * rule for that single option ANDed together (its type tuple, the D2
 * SUPPLIER_PAYMENT/EXPENSE auto-row hide, the Cash Only leg check). The
 * multi-select's union is `effectiveOptions.some(opt =>
 * isRowVisibleForOption(row, opt))` in `load` below: "Whish App Send" +
 * "Katsh Bills" shows a row that matches EITHER option's full rule set, not
 * just a shared type.
 */
function isRowVisibleForOption(
  row: TransactionRow,
  option: FilterOption,
): boolean {
  if (!matchesTypeTuple(row, option)) return false;
  if (
    row.type === "SUPPLIER_PAYMENT" &&
    !isSupplierPaymentVisible(row.metadata_json, option)
  ) {
    return false;
  }
  if (row.type === "EXPENSE" && !isExpenseVisible(row.metadata_json, option)) {
    return false;
  }
  if (option.cash_only) {
    // LIRA-201b: `row.payments` is now ALWAYS this row's own legs only — a
    // session member with no own legs no longer inherits the basket's cash
    // leg into it (see TransactionRepository._attachPaymentLegs). Whether
    // the till was actually touched for that member's session is answered
    // by the pooled `session_payments` instead, so it must be included here
    // too — otherwise a cash-paid session basket would silently vanish from
    // "Cash only (till)" for every member except whichever one the pooled
    // leg happens to sit on (usually none, since the basket payment is
    // posted with transaction_id NULL).
    const legs = [
      ...(row.payments ?? []),
      ...(row.session_payments ?? []),
      ...extraCurrencyLegs(row.type, row.metadata_json),
    ];
    if (!isCashTransaction(legs)) return false;
  }
  return true;
}

/** "All types" (nothing selected) is represented as one implicit option with
 *  no constraints at all — reproduces exactly the historical `activeOption
 *  === undefined` default-view behavior (D2 hides auto rows, nothing else
 *  narrowed) via the SAME isRowVisibleForOption used for a real selection. */
const ALL_TYPES_OPTION: FilterOption = { label: "" };

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
export const HIDDEN_TRANSACTION_TYPES = new Set(["CLIENT_CREATED"]);

/** Multiplier applied to the requested row count on the first fetch, and
 *  again on every widening pass. */
const WIDEN_FACTOR = 3;
/** Never fetch more than this, however under-filled the window stays. */
const FETCH_CAP = 5000;

export interface UseTransactionRowsParams {
  /** Row count the operator asked for, as the raw select value. */
  limit: string;
  /** Labels of the SELECTED FILTER_GROUPS options — a UNION (OR) of every
   *  one's tuple. Empty array means "All types" (the cleared state). */
  selectedFilters: string[];
  search: string;
  /** Inclusive yyyy-mm-dd date bounds, "" when unset. */
  from: string;
  to: string;
}

export interface UseTransactionRowsResult {
  /** Visible rows for the active type/search filter, capped at `limit`. */
  rows: TransactionRow[];
  /** `rows` narrowed to the from/to date range — what the table renders. */
  filteredRows: TransactionRow[];
  loading: boolean;
  /** Re-run the query (after a void/refund writes). */
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
   * LIRA-232 round-3 review (finding 2) — session ids that have ANY payout
   * member (a loto cash prize, a wallet/Binance cash-out, a custom-service
   * booked as a payout — anything netted against the basket's other items
   * at checkout). Core refuses `refundSessionBasketItem` for EVERY member of
   * such a basket, not just the payout row itself, so the Transactions page
   * hides "Refund item" for the whole session rather than offering a button
   * that's guaranteed to error.
   *
   * LIRA-236 follow-up (2026-09-27 review) — a payout member is now derived
   * from each row's own server-computed `is_session_payout` flag
   * (`TransactionRow.is_session_payout`, `getRecent`'s addition), NOT the
   * former `isSessionPayoutMember` amount-sign predicate (`@liratek/core`).
   * The sign check missed a wallet/Binance cash-out entirely: THAT member's
   * own `transactions` row carries a positive-or-zero amount — only the
   * session's pooled basket-link row ever carried the negative customer-side
   * amount — so it never landed in this set and "Refund item" stayed offered
   * on a basket the server refuses. The flag also keeps the OLD guarantee
   * for free: an item-refund REFUND row's own negative amount was never
   * flagged `is_session_payout` (core stamps it only on a genuine netted
   * payout), so it still never hides "Refund item" for a sibling basket
   * member. Absent/undefined reads as NOT a payout — never hidden. Derived
   * from `rows` (not a dedicated unfiltered fetch like `sessionsWithItemRefund`
   * above) — a narrower fix than finding 3's, scoped to what this finding
   * asked for.
   */
  sessionsWithPayoutMember: Set<number>;
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

export function useTransactionRows({
  limit,
  selectedFilters,
  search,
  from,
  to,
}: UseTransactionRowsParams): UseTransactionRowsResult {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  // LIRA-232 round-3 review (finding 3) — populated ONLY while a filter is
  // active (see `hasActiveFilter` below); `null` otherwise, meaning "derive
  // it from `rows` instead" (see the `sessionsWithItemRefund` memo at the
  // bottom of this hook).
  const [dedicatedSessionsWithItemRefund, setDedicatedSessionsWithItemRefund] =
    useState<Set<number> | null>(null);

  // A content-derived primitive key, not the array reference itself. Any
  // caller that builds `selectedFilters` fresh per render (an inline `[]` in
  // JSX, say) would otherwise recreate `load` — and refire the effect below
  // — every render even though the actual selection hasn't changed
  // (CLAUDE.md rule 25: an unstable *dependency*, not the array type itself,
  // is the hazard). Order-independent, so reordering the same selection is a
  // no-op re-fetch.
  const filterKey = selectedFilters.slice().sort().join("|");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const activeOptions = ALL_FILTER_OPTIONS.filter((o) =>
        selectedFilters.includes(o.label),
      );
      const filters: TransactionFiltersParam = {};

      // One (type, provider, service_type, has_item_key) tuple per selected
      // option that HAS a type — the multi-select's OR-group, sent to the
      // repository as `typeFilters` (TransactionRepository.getRecent OR's
      // them together at the SQL level, so LIMIT still applies to
      // already-filtered rows). An UNTYPED option (today, only "Cash only
      // (till)") can match a row of ANY type, so mixing it into the same
      // selection means the union can no longer be expressed as a SQL type
      // restriction at all — leave the fetch unrestricted by type in that
      // case (typeFilters omitted) and let filterVisible's per-row union
      // below (isRowVisibleForOption) do the real narrowing, exactly like
      // today's single "Cash only" selection already does.
      const typeTuples: TypeFilterTuple[] = activeOptions
        .filter((o) => o.type)
        .map(
          (o) =>
            ({
              // FilterOption.type is a plain `string` — FILTER_GROUPS'
              // values are curated to real transaction-type strings (they
              // already drive this same repository's singular `type`
              // filter), but nothing ties that literal-for-literal to the
              // core schema's narrower enum at this frontend layer, hence
              // the cast.
              type: o.type,
              provider: o.provider,
              service_type: o.service_type,
              has_item_key: o.has_item_key,
            }) as TypeFilterTuple,
        );
      if (
        activeOptions.length > 0 &&
        typeTuples.length === activeOptions.length
      ) {
        filters.typeFilters = typeTuples;
      }
      if (search) filters.search = search;

      // Exclude the always-hidden types at the SQL level so LIMIT is applied
      // to already-filtered rows — a burst of hidden-type rows (e.g. hundreds
      // of CLIENT_CREATED from a bulk import) can no longer crowd genuinely
      // visible rows out of the result window. CLIENT_CREATED is the only
      // type that's safe to exclude here: its hide/show is never conditional
      // on per-row metadata. SUPPLIER_PAYMENT (D2) is NOT excluded — whether
      // a given row shows depends on metadata.is_auto, which the SQL filter
      // can't see, so that decision is made entirely client-side below.
      filters.excludeTypes = Array.from(HIDDEN_TRANSACTION_TYPES);

      const requested = Number(limit) || 50;
      // "All types" (nothing selected) reproduces the exact default-view
      // rule every per-option helper below already implements for a
      // type-less, cash_only-less option.
      const effectiveOptions: FilterOption[] =
        activeOptions.length > 0 ? activeOptions : [ALL_TYPES_OPTION];

      const filterVisible = (fetched: TransactionRow[]) =>
        fetched.filter((r) => {
          if (HIDDEN_TRANSACTION_TYPES.has(r.type)) return false;
          // The multi-select's union: visible if it matches ANY selected
          // option's full rule set (rule 17 guard below proves this isn't
          // accidentally an AND, or a match on the first option only).
          return effectiveOptions.some((opt) => isRowVisibleForOption(r, opt));
        });

      // The SQL exclusion only covers CLIENT_CREATED (plus, when every
      // selected option is typed, the typeFilters union above). The per-row
      // JS-only filters (SUPPLIER_PAYMENT/EXPENSE auto-hide, Cash Only's
      // joined payment legs, and any mixed cash_only+typed selection) can
      // under-fill a window — a run of auto-generated supplier rows is the
      // same "crowds out real rows" risk CLIENT_CREATED bulk-imports posed
      // pre-D2 — so keep widening the fetch until it's satisfied or the
      // table is exhausted (raw came back shorter than what we asked for).
      let fetchSize = requested * WIDEN_FACTOR;
      const cap = Math.max(fetchSize, FETCH_CAP);
      let visible: TransactionRow[] = [];
      for (;;) {
        const raw = ((await getRecentTransactions(fetchSize, filters)) ||
          []) as TransactionRow[];
        visible = filterVisible(raw);
        if (
          visible.length >= requested ||
          raw.length < fetchSize ||
          fetchSize >= cap
        ) {
          break;
        }
        fetchSize *= WIDEN_FACTOR;
      }
      setRows(visible.slice(0, requested));
    } finally {
      setLoading(false);
    }
    // `filterKey` (not `selectedFilters`) is the intentional dependency —
    // see the comment on its declaration above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, filterKey, search]);

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
  const hasActiveFilter = selectedFilters.length > 0 || from !== "" || to !== "";

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
    load();
  }, [load]);

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
  const reload = useCallback(() => {
    load();
    if (hasActiveFilter) loadSessionsWithItemRefund();
  }, [load, hasActiveFilter, loadSessionsWithItemRefund]);

  const filteredRows = useMemo(() => {
    if (!from && !to) return rows;
    return rows.filter((row) => {
      const dateVal = (row.created_at ?? "").slice(0, 10);
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

  // LIRA-232 round-3 review (finding 2) / LIRA-236 follow-up — see the
  // field's own doc above: flag-derived, not amount-sign-derived.
  const sessionsWithPayoutMember = useMemo(() => {
    const ids = new Set<number>();
    for (const row of rows) {
      if (row.session_id != null && row.is_session_payout === true) {
        ids.add(row.session_id);
      }
    }
    return ids;
  }, [rows]);

  // Coordinator follow-up (2026-09-27), item 5 — session ids where EVERY
  // member has already been refunded item by item (server-computed,
  // `TransactionRow.session_fully_refunded` / `TransactionRepository
  // .isSessionBasketFullyRefunded`, stamped identically onto every row of
  // that session by `getRecent()`). Mirrors `sessionsWithPayoutMember`
  // immediately above (rule 14): derived from `rows` (the full page-level
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
    reload,
    sessionsWithItemRefund,
    sessionsWithPayoutMember,
    sessionsFullyRefunded,
  };
}

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

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (!from && !to) return rows;
    return rows.filter((row) => {
      const dateVal = (row.created_at ?? "").slice(0, 10);
      if (from && dateVal < from) return false;
      if (to && dateVal > to) return false;
      return true;
    });
  }, [rows, from, to]);

  return { rows, filteredRows, loading, reload: load };
}

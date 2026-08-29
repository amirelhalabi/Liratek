import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getRecentTransactions,
  type TransactionFiltersParam,
} from "@/api/backendApi";
import { FILTER_GROUPS, isSupplierPaymentVisible } from "../auditConstants";
import { isCashTransaction, extraCurrencyLegs } from "../cashFlow";
import type { TransactionPaymentLeg } from "../cashFlow";

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
  payments?: TransactionPaymentLeg[];
  // CUSTOMER_ACCOUNT settlement of a session basket, sourced from debt_ledger
  // (never written to `payments` — see TransactionWithUser in the backend for
  // why). Kept separate so the cash-only Summary in:/out: line is unaffected;
  // only the Method column should read this.
  account_payments?: TransactionPaymentLeg[];
};

const ALL_OPTIONS = FILTER_GROUPS.flatMap((g) => g.options);

// Transaction types blanket-hidden from the table regardless of any per-row
// metadata: client-activity log noise (CLIENT_CREATED), not useful in the
// operator-facing list by default.
//
// SUPPLIER_PAYMENT used to blanket-hide here too. D2 (CQ-8) replaced that:
// a manual supplier payment is now a first-class visible row and only the
// auto-generated ledger siblings (metadata.is_auto === true) stay hidden by
// default — see isSupplierPaymentVisible (auditConstants.ts), applied
// per-row below since the SQL-level `excludeTypes` can only exclude by
// type, not by metadata.
export const HIDDEN_TRANSACTION_TYPES = new Set(["CLIENT_CREATED"]);

/** Multiplier applied to the requested row count on the first fetch, and
 *  again on every widening pass. */
const WIDEN_FACTOR = 3;
/** Never fetch more than this, however under-filled the window stays. */
const FETCH_CAP = 5000;

export interface UseTransactionRowsParams {
  /** Row count the operator asked for, as the raw select value. */
  limit: string;
  /** Label of the active FILTER_GROUPS option. */
  selectedFilter: string;
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
  selectedFilter,
  search,
  from,
  to,
}: UseTransactionRowsParams): UseTransactionRowsResult {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const activeOption = ALL_OPTIONS.find((o) => o.label === selectedFilter);
      const filters: TransactionFiltersParam = {};
      if (activeOption?.type) filters.type = activeOption.type;
      if (activeOption?.provider) filters.provider = activeOption.provider;
      if (activeOption?.service_type)
        filters.service_type = activeOption.service_type;
      if (activeOption?.has_item_key !== undefined)
        filters.has_item_key = activeOption.has_item_key;
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
      const filterVisible = (fetched: TransactionRow[]) => {
        let vis = fetched.filter((r) => {
          if (HIDDEN_TRANSACTION_TYPES.has(r.type)) return false;
          if (r.type === "SUPPLIER_PAYMENT") {
            return isSupplierPaymentVisible(r.metadata_json, activeOption);
          }
          return true;
        });
        // B6: "Cash only (till)" — keep transactions with a CASH payment leg.
        // A foreign-currency top-up/cash-out is till cash posted with the CASH
        // method (its Method column says so); dropping it here purely because
        // the leg can't survive the upstream USD/LBP filter would contradict
        // the row's own displayed method.
        if (activeOption?.cash_only) {
          vis = vis.filter((r) =>
            isCashTransaction([
              ...(r.payments ?? []),
              ...extraCurrencyLegs(r.type, r.metadata_json),
            ]),
          );
        }
        return vis;
      };

      // The SQL exclusion only covers CLIENT_CREATED now. The per-row
      // JS-only filters above (SUPPLIER_PAYMENT's is_auto/is_credit checks,
      // Cash Only's joined payment legs) can under-fill a window — a run of
      // auto-generated supplier rows is the same "crowds out real rows"
      // risk CLIENT_CREATED bulk-imports posed pre-D2 — so keep widening the
      // fetch until it's satisfied or the table is exhausted (raw came back
      // shorter than what we asked for).
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
  }, [limit, selectedFilter, search]);

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

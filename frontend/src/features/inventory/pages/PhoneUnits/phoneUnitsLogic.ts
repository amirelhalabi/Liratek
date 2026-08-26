/**
 * Phone Units page — pure, React-free logic (filter-state → query args, and
 * the pagination arithmetic). Kept out of `index.tsx` so it is unit-testable
 * in isolation and so that file exports ONLY its component (a module mixing a
 * component export with plain function exports breaks React Fast Refresh —
 * `react-refresh/only-export-components`), the same split
 * `productUnitsLogic.ts` uses for `warrantyBadgeInfo`.
 */
import type { UnitListFilters } from "../../hooks/useProductUnits";

/** Rows per page. Well under the Zod ceiling (limit ≤ 200). */
export const PHONE_UNITS_PAGE_SIZE = 25;

/** Mirrors the Zod schema's `search` max — enforced on the input too so a
 *  long paste is trimmed here instead of being rejected by the backend. */
export const PHONE_UNITS_SEARCH_MAX = 64;

/** How long the search box waits after the last keystroke before the term is
 *  applied. Defined here so the page and its tests share ONE number instead
 *  of each hardcoding 300. */
export const PHONE_UNITS_SEARCH_DEBOUNCE_MS = 300;

/** `""` = no status filter (the "All" option). */
export type PhoneUnitsStatusFilter = "" | "IN_STOCK" | "SOLD";

export interface PhoneUnitsFilterState {
  status: PhoneUnitsStatusFilter;
  defectiveOnly: boolean;
  /** The DEBOUNCED search term (the raw input is page state). */
  search: string;
  /** 0-based page index. */
  page: number;
  pageSize: number;
}

/**
 * Filter state → the `UnitListFilters` payload sent over IPC/REST.
 *
 * Optional filters are OMITTED rather than sent as empty/false so the request
 * carries only what the operator actually chose — the Zod schema marks each of
 * them `.optional()`, and an omitted key is what "no filter" means to the
 * repository's WHERE builder. `limit`/`offset` are always present.
 */
export function buildUnitListFilters(
  state: PhoneUnitsFilterState,
): UnitListFilters {
  const filters: UnitListFilters = {
    limit: state.pageSize,
    offset: state.page * state.pageSize,
  };
  if (state.status !== "") filters.status = state.status;
  if (state.defectiveOnly) filters.defectiveOnly = true;
  const search = state.search.trim().slice(0, PHONE_UNITS_SEARCH_MAX);
  if (search !== "") filters.search = search;
  return filters;
}

export interface PhoneUnitsPageRange {
  /** 1-based index of the first row on screen (0 when there are none). */
  start: number;
  /** 1-based index of the last row on screen (0 when there are none). */
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** e.g. "26–50 of 137" — "0 of 0" when the filter matched nothing. */
  label: string;
}

/**
 * Pagination arithmetic against the SERVER's `total` (COUNT(*) over the same
 * WHERE), not `rows.length` — the whole point of the list contract returning
 * both. `rowCount` is how many rows this page actually came back with.
 *
 * `hasNext` requires a non-empty page: an over-paged request (filters
 * narrowed while sitting on page 4, so the page comes back empty while
 * `total` is still positive) offers Prev only, never a Next into more
 * emptiness.
 */
export function computePageRange(
  offset: number,
  rowCount: number,
  total: number,
): PhoneUnitsPageRange {
  const empty = rowCount === 0 || total === 0;
  const start = empty ? 0 : offset + 1;
  const end = empty ? 0 : offset + rowCount;
  return {
    start,
    end,
    hasPrev: offset > 0,
    hasNext: !empty && end < total,
    label: empty ? `0 of ${total}` : `${start}–${end} of ${total}`,
  };
}

/**
 * Badge colours for a unit's stock status — the same sky/slate pairing
 * `ProductUnitsSection` and `ImeiStoryCard` render inline. Presentational
 * only (no domain rule), so it is defined once here for this page rather than
 * a fourth inline copy; a follow-up can lift it into `productUnitsLogic.ts`
 * and have all three call it (that file is owned by another workstream in this
 * build).
 */
export function unitStatusBadgeClass(status: "IN_STOCK" | "SOLD"): string {
  return status === "IN_STOCK"
    ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
    : "bg-slate-700/40 text-slate-300 border-slate-600/40";
}

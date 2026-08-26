import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Search,
  Smartphone,
  Trash2,
} from "lucide-react";
import { DataTable, PageHeader, Select, appEvents } from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { ImeiStoryCard } from "../../components/ImeiStoryCard";
import { warrantyDisplayBadge } from "../../productUnitsLogic";
import {
  useDeleteUnitMutation,
  useUnitListQuery,
  useUnitStoryQuery,
  type UnitListRowWithWarranty,
} from "../../hooks/useProductUnits";
import {
  PHONE_UNITS_PAGE_SIZE,
  PHONE_UNITS_SEARCH_DEBOUNCE_MS,
  PHONE_UNITS_SEARCH_MAX,
  buildUnitListFilters,
  computePageRange,
  unitStatusBadgeClass,
  type PhoneUnitsStatusFilter,
} from "./phoneUnitsLogic";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "IN_STOCK", label: "In stock" },
  { value: "SOLD", label: "Sold" },
];

/**
 * LIRA-143 — the standalone "Phone Units" management view (`/inventory/units`).
 *
 * Where `ProductUnitsSection` shows the units of ONE product inside its form,
 * this page is the shop-wide register: every registered IMEI, filterable by
 * stock status / defective flag / a debounced IMEI-or-product search, paginated
 * SERVER-side against the list contract's `total` (never `rows.length` — the
 * table only ever holds one page). Clicking a row toggles that unit's full
 * provenance card (`ImeiStoryCard`, the same one the walk-in lookup renders)
 * above the table. Delete is offered for `IN_STOCK` units only — the backend
 * refuses a `SOLD` one, so the button is never rendered for it.
 */
export default function PhoneUnits() {
  const navigate = useNavigate();

  // ── Filter state ───────────────────────────────────────────────────────
  const [status, setStatus] = useState<PhoneUnitsStatusFilter>("");
  const [defectiveOnly, setDefectiveOnly] = useState(false);
  /** Raw input value — mirrored into `search` (trimmed) after
   *  `PHONE_UNITS_SEARCH_DEBOUNCE_MS` of quiet so typing an IMEI doesn't fire
   *  a request per keystroke. */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // EVERY filter change also resets to page 1 — otherwise narrowing the
  // filters while sitting on page 4 lands on an empty page with rows to show.
  // Done in the three change paths, never in an effect on the filter values
  // (`react-hooks/set-state-in-effect`).
  //
  // The search debounce is therefore armed by the KEYSTROKE, not by an effect
  // on `searchInput`: an effect also runs on MOUNT, so its `setPage(0)` landed
  // ~300ms into the session and silently undid any pagination click made
  // inside that window — the pager bounced back to page 1 and a second
  // request went out with offset 0 (it also reddened the pagination unit test
  // about half the time under full-suite load). `appliedSearch` then keeps the
  // reset honest: an edit that resolves to the term already applied (retyping
  // it, or whitespace the payload trims anyway) is not a filter change and
  // leaves the current page alone. A genuinely new term still resets to page
  // 1 — page 3 of a different result set is meaningless.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedSearch = useRef("");

  // Only cleanup — a pending debounce must not fire into an unmounted page.
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      const next = value.trim();
      if (next === appliedSearch.current) return;
      appliedSearch.current = next;
      setSearch(next);
      setPage(0);
    }, PHONE_UNITS_SEARCH_DEBOUNCE_MS);
  };

  const handleStatusChange = (value: string) => {
    setStatus(value as PhoneUnitsStatusFilter);
    setPage(0);
  };

  const handleDefectiveChange = (checked: boolean) => {
    setDefectiveOnly(checked);
    setPage(0);
  };

  const filters = useMemo(
    () =>
      buildUnitListFilters({
        status,
        defectiveOnly,
        search,
        page,
        pageSize: PHONE_UNITS_PAGE_SIZE,
      }),
    [status, defectiveOnly, search, page],
  );

  const { data, isLoading, isError } = useUnitListQuery(filters);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const range = computePageRange(filters.offset, rows.length, total);

  // ── Expanded story panel ───────────────────────────────────────────────
  const [expandedImei, setExpandedImei] = useState<string | null>(null);
  const { data: stories = [] } = useUnitStoryQuery(expandedImei);

  const toggleExpanded = (imei: string) => {
    setExpandedImei((prev) => (prev === imei ? null : imei));
  };

  // ── Delete (IN_STOCK only) ─────────────────────────────────────────────
  // No productId in hand here — the mutation invalidates the list prefix, so
  // the current page refetches regardless.
  const deleteUnit = useDeleteUnitMutation(null);

  const handleDelete = async (unit: UnitListRowWithWarranty) => {
    if (!confirm(`Remove unit ${unit.imei}? This cannot be undone.`)) return;
    try {
      const result = await deleteUnit.mutateAsync(unit.id);
      if (!result.success) {
        appEvents.emit(
          "notification:show",
          result.error ?? "Failed to delete unit",
          "error",
        );
        return;
      }
      if (expandedImei === unit.imei) setExpandedImei(null);
    } catch (err) {
      appEvents.emit(
        "notification:show",
        err instanceof Error ? err.message : "Failed to delete unit",
        "error",
      );
    }
  };

  return (
    <div
      data-testid="phone-units-page"
      className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500"
    >
      <PageHeader
        icon={Smartphone}
        title="Phone Units"
        subtitle="Every registered IMEI — stock status, sale, and warranty"
        actions={
          <button
            type="button"
            data-testid="phone-units-back"
            onClick={() => navigate("/products")}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all"
          >
            <ArrowLeft size={18} />
            Back to Inventory
          </button>
        }
      />

      {/* Filters */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-2.5 text-slate-500 h-5 w-5" />
          <input
            type="text"
            data-testid="phone-units-search"
            aria-label="Search units by IMEI or product"
            value={searchInput}
            maxLength={PHONE_UNITS_SEARCH_MAX}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search by IMEI or product..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
          />
        </div>

        <Select
          value={status}
          onChange={handleStatusChange}
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          className="w-44"
          buttonClassName="py-2"
        />

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid="phone-units-defective-toggle"
            checked={defectiveOnly}
            onChange={(e) => handleDefectiveChange(e.target.checked)}
            className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-violet-600 cursor-pointer"
          />
          Defective only
        </label>
      </div>

      {/* Expanded unit story — the SAME card the walk-in IMEI lookup renders.
          `getStory` returns every unit with this exact IMEI (there can be more
          than one historically), so all of them are shown. */}
      {expandedImei && stories.length > 0 && (
        <div className="space-y-2" data-testid="phone-units-story-panel">
          {stories.map((story) => (
            <ImeiStoryCard key={story.id} story={story} />
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto shadow-xl">
        <DataTable<UnitListRowWithWarranty>
          columns={[
            { header: "IMEI", className: "p-3 border-b border-slate-700" },
            { header: "Product", className: "p-3 border-b border-slate-700" },
            {
              header: "Status",
              className: "p-3 border-b border-slate-700",
              width: "110px",
            },
            {
              header: "Defective",
              className: "p-3 border-b border-slate-700",
              width: "110px",
            },
            {
              header: "Sold",
              className: "p-3 border-b border-slate-700",
              width: "110px",
            },
            { header: "Client", className: "p-3 border-b border-slate-700" },
            { header: "Warranty", className: "p-3 border-b border-slate-700" },
            {
              header: "Actions",
              className: "p-3 border-b border-slate-700 text-right",
              width: "80px",
            },
          ]}
          data={rows}
          loading={isLoading}
          emptyMessage={
            isError ? "Failed to load units." : "No units match these filters."
          }
          exportExcel
          exportPdf
          exportFilename="phone-units"
          showRowCount
          totalRowCount={total}
          className="w-full text-left border-collapse"
          theadClassName="bg-slate-800/50 text-slate-400 text-xs uppercase font-semibold"
          tbodyClassName="divide-y divide-slate-700 text-sm"
          renderRow={(unit) => {
            // Unsold stock of a model that HAS a warranty term shows the term
            // ("6 mo — starts at sale") instead of "No warranty": the clock
            // starts at the sale (decision #4), so `NONE` here means "not yet",
            // not "never" (owner-reported 2026-08-26). Every other verdict —
            // and every SOLD unit — renders exactly as before.
            const badge = warrantyDisplayBadge({
              warranty: unit.warranty,
              status: unit.status,
              productWarrantyMonths: unit.product_warranty_months,
            });
            const isExpanded = expandedImei === unit.imei;
            return (
              <tr
                key={unit.id}
                data-testid={`phone-unit-row-${unit.id}`}
                onClick={() => toggleExpanded(unit.imei)}
                className={`cursor-pointer transition-colors ${
                  isExpanded
                    ? "bg-violet-900/20 hover:bg-violet-900/30"
                    : "hover:bg-slate-700/50"
                }`}
              >
                <td className="p-3 font-mono text-white">{unit.imei}</td>
                <td className="p-3 text-slate-300">{unit.product_name}</td>
                <td className="p-3">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${unitStatusBadgeClass(unit.status)}`}
                  >
                    {unit.status}
                  </span>
                </td>
                <td className="p-3">
                  {unit.is_defective ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/30">
                      Defective
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="p-3 text-slate-400 text-xs">
                  {unit.sold_at ? (
                    parseDbDate(unit.sold_at).toLocaleDateString()
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="p-3 text-slate-300">
                  {unit.client_name ?? <span className="text-slate-600">—</span>}
                </td>
                <td className="p-3">
                  <span
                    data-testid={`phone-unit-warranty-${unit.id}`}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {unit.status === "IN_STOCK" ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(unit);
                      }}
                      disabled={deleteUnit.isPending}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors disabled:opacity-50"
                      title="Remove unit"
                      aria-label={`Remove unit ${unit.imei}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : (
                    <span className="text-slate-600 text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          }}
        />

        {/* Server-side pagination — DataTable's own `paginate` only slices the
            array it was handed, which here is a single page. */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 bg-slate-800/50">
          <span className="text-sm text-slate-400" data-testid="phone-units-range">
            {range.label} units
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="phone-units-prev"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={!range.hasPrev}
              aria-label="Previous page"
              className="p-1.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              data-testid="phone-units-next"
              onClick={() => setPage((p) => p + 1)}
              disabled={!range.hasNext}
              aria-label="Next page"
              className="p-1.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

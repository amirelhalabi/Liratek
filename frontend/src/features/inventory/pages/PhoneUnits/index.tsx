import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { useFormat } from "@/i18n/useFormat";
import { DirIcon } from "@liratek/ui/components/ui/DirIcon";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Search,
  Trash2,
} from "lucide-react";
import {
  DataTable,
  PageHeader,
  Select,
  appEvents,
  exportToExcel,
  exportToPdf,
  useApi,
} from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { ImeiStoryCard } from "../../components/ImeiStoryCard";
import { warrantyDisplayBadge } from "../../productUnitsLogic";
import {
  fetchAllUnitsForExport,
  useDeleteUnitMutation,
  useUnitListQuery,
  useUnitStoryQuery,
  type UnitListRowWithWarranty,
} from "../../hooks/useProductUnits";
import {
  PHONE_UNITS_EXPORT_MAX_ROWS,
  PHONE_UNITS_EXPORT_PAGE_SIZE,
  PHONE_UNITS_PAGE_SIZE,
  PHONE_UNITS_SEARCH_DEBOUNCE_MS,
  PHONE_UNITS_SEARCH_MAX,
  buildUnitExportTable,
  buildUnitListFilters,
  computePageRange,
  exportCapConfirmMessage,
  phoneUnitsExportFilename,
  planExportFetch,
  unitStatusBadgeClass,
  type PhoneUnitsStatusFilter,
} from "./phoneUnitsLogic";


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
  const api = useApi();
  const { t } = useTranslation("inventory");
  const { formatDate } = useFormat();
  // Option values are the stored status codes; only the labels translate.
  const statusOptions = useMemo(
    () => [
      { value: "", label: t("phoneUnits.statusAll") },
      { value: "IN_STOCK", label: t("phoneUnits.statusInStock") },
      { value: "SOLD", label: t("phoneUnits.statusSold") },
    ],
    [t],
  );

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
  const range = computePageRange(filters.offset, rows.length, total, t);

  // ── Expanded story panel ───────────────────────────────────────────────
  const [expandedImei, setExpandedImei] = useState<string | null>(null);
  const { data: stories = [] } = useUnitStoryQuery(expandedImei);

  const toggleExpanded = (imei: string) => {
    setExpandedImei((prev) => (prev === imei ? null : imei));
  };

  // ── Export ALL filtered rows (owner item #6) ───────────────────────────
  // This page paginates SERVER-side, so `DataTable`'s own export bar — which
  // builds its file from the `data` prop it was handed — would have written
  // whatever 25 rows happened to be on screen. Its buttons are therefore
  // switched off (`exportExcel`/`exportPdf` omitted below, `showRowCount`
  // kept so the count label still renders) and the page drives the same house
  // writers (`exportToExcel`/`exportToPdf`) itself, after looping the list
  // endpoint for every row matching the CURRENT filters.
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const handleExport = async (kind: "excel" | "pdf") => {
    if (exporting || total === 0) return;

    // `total` is the server's COUNT(*) over these exact filters — the same
    // number the pager labels itself with — so the cap decision is made
    // BEFORE any fetching, and a cancel costs zero requests.
    if (
      total > PHONE_UNITS_EXPORT_MAX_ROWS &&
      !confirm(
        exportCapConfirmMessage(total, PHONE_UNITS_EXPORT_MAX_ROWS, t),
      )
    ) {
      return;
    }

    setExporting(kind);
    try {
      const plan = planExportFetch(total);
      // The SAME builder the on-screen query uses, so the export can never
      // apply a different filter set than the table it came from — only the
      // page size differs (200, the contract's ceiling).
      const {
        limit: _limit,
        offset: _offset,
        ...base
      } = buildUnitListFilters({
        status,
        defectiveOnly,
        search,
        page: 0,
        pageSize: PHONE_UNITS_EXPORT_PAGE_SIZE,
      });

      const { rows: allRows, capped } = await fetchAllUnitsForExport(
        (filters) => api.productUnits.list(filters),
        base,
        plan,
      );

      if (allRows.length === 0) {
        appEvents.emit(
          "notification:show",
          t("phoneUnits.nothingToExport"),
          "info",
        );
        return;
      }

      const filename = phoneUnitsExportFilename();
      const table = buildUnitExportTable(allRows);
      if (kind === "excel") exportToExcel(table, filename);
      else exportToPdf(table, filename);

      if (capped) {
        appEvents.emit(
          "notification:show",
          t("phoneUnits.exportedCapped", {
            cap: formatNumber(PHONE_UNITS_EXPORT_MAX_ROWS),
            total: formatNumber(total),
          }),
          "warning",
        );
      }
    } catch (err) {
      appEvents.emit(
        "notification:show",
        err instanceof Error ? err.message : t("phoneUnits.exportFailed"),
        "error",
      );
    } finally {
      setExporting(null);
    }
  };

  const exportDisabled = exporting !== null || isLoading || total === 0;

  // ── Delete (IN_STOCK only) ─────────────────────────────────────────────
  // No productId in hand here — the mutation invalidates the list prefix, so
  // the current page refetches regardless.
  const deleteUnit = useDeleteUnitMutation(null);

  const handleDelete = async (unit: UnitListRowWithWarranty) => {
    if (!confirm(t("phoneUnits.confirmRemove", { imei: unit.imei }))) return;
    try {
      const result = await deleteUnit.mutateAsync(unit.id);
      if (!result.success) {
        appEvents.emit(
          "notification:show",
          result.error ?? t("unit.deleteFailed"),
          "error",
        );
        return;
      }
      if (expandedImei === unit.imei) setExpandedImei(null);
    } catch (err) {
      appEvents.emit(
        "notification:show",
        err instanceof Error ? err.message : t("unit.deleteFailed"),
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
        title={t("phoneUnits.title")}
        subtitle={t("phoneUnits.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            {/* Export ALL rows matching the current filters, not the page on
                screen. Same emerald/red pairing as every other table's
                ExportBar so the affordance still reads as "the export
                buttons" despite living up here. */}
            <button
              type="button"
              data-testid="phone-units-export-excel"
              onClick={() => handleExport("excel")}
              disabled={exportDisabled}
              title={t("phoneUnits.exportExcelTitle")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileSpreadsheet size={14} />
              {exporting === "excel"
                ? t("phoneUnits.exporting")
                : t("phoneUnits.excel")}
            </button>
            <button
              type="button"
              data-testid="phone-units-export-pdf"
              onClick={() => handleExport("pdf")}
              disabled={exportDisabled}
              title={t("phoneUnits.exportPdfTitle")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileText size={14} />
              {exporting === "pdf"
                ? t("phoneUnits.exporting")
                : t("phoneUnits.pdf")}
            </button>
            <button
              type="button"
              data-testid="phone-units-back"
              onClick={() => navigate("/products")}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all"
            >
              <DirIcon icon={ArrowLeft} width={18} height={18} />
              {t("phoneUnits.back")}
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute start-3 top-2.5 text-slate-500 h-5 w-5" />
          <input
            type="text"
            data-testid="phone-units-search"
            aria-label={t("phoneUnits.searchAria")}
            value={searchInput}
            maxLength={PHONE_UNITS_SEARCH_MAX}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder={t("phoneUnits.searchPlaceholder")}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg ps-10 pe-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
          />
        </div>

        <Select
          value={status}
          onChange={handleStatusChange}
          options={statusOptions}
          placeholder={t("phoneUnits.statusAll")}
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
          {t("phoneUnits.defectiveOnly")}
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
            { header: t("phoneUnits.columns.imei"), className: "p-3 border-b border-slate-700" },
            {
              header: t("phoneUnits.columns.product"),
              className: "p-3 border-b border-slate-700",
            },
            {
              header: t("phoneUnits.columns.status"),
              className: "p-3 border-b border-slate-700",
              width: "110px",
            },
            {
              header: t("phoneUnits.columns.defective"),
              className: "p-3 border-b border-slate-700",
              width: "110px",
            },
            {
              header: t("phoneUnits.columns.sold"),
              className: "p-3 border-b border-slate-700",
              width: "110px",
            },
            {
              header: t("phoneUnits.columns.client"),
              className: "p-3 border-b border-slate-700",
            },
            {
              header: t("phoneUnits.columns.warranty"),
              className: "p-3 border-b border-slate-700",
            },
            {
              header: t("phoneUnits.columns.actions"),
              className: "p-3 border-b border-slate-700 text-end",
              width: "80px",
            },
          ]}
          data={rows}
          loading={isLoading}
          emptyMessage={
            isError ? t("phoneUnits.loadFailed") : t("phoneUnits.noMatch")
          }
          /* No exportExcel/exportPdf here on purpose — DataTable's exporter
             builds from the `data` prop, which on this server-paginated page
             is ONE page. The page-header buttons export every matching row
             instead (see `handleExport`). `showRowCount` keeps the count
             label, which ExportBar renders independently of the buttons. */
          showRowCount
          totalRowCount={total}
          className="w-full text-start border-collapse"
          theadClassName="bg-slate-800/50 text-slate-400 text-xs uppercase font-semibold"
          tbodyClassName="divide-y divide-slate-700 text-sm"
          renderRow={(unit) => {
            // An in-stock unit reads "Not sold" (plus the model's term, if
            // any); a sold unit shows its verdict (LIRA-296 follow-up).
            const badge = warrantyDisplayBadge(
              {
              warranty: unit.warranty,
              status: unit.status,
              productWarrantyMonths: unit.product_warranty_months,
              },
              t,
            );
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
                <td className="p-3 text-slate-300">
                  <div className="flex items-center gap-2">
                    <span>{unit.product_name}</span>
                    {/* LIRA-152 — a sold unit of a soft-deleted product stays
                        in this register (it is history), but nothing else on
                        the row said the product was gone. Muted/secondary on
                        purpose — same slate family as the "No warranty"
                        badge below, never an alarm color. */}
                    {unit.product_deleted === 1 && (
                      <span
                        data-testid={`phone-unit-product-deleted-${unit.id}`}
                        title={t("unit.productDeletedTitle")}
                        className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-700/40 text-slate-400 border-slate-600/40"
                      >
                        {t("unit.productDeleted")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-3">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${unitStatusBadgeClass(unit.status)}`}
                  >
                    {t(`unit.status.${unit.status}`)}
                  </span>
                </td>
                <td className="p-3">
                  {unit.is_defective ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/30">
                      {t("unit.defective")}
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="p-3 text-slate-400 text-xs">
                  {unit.sold_at ? (
                    formatDate(parseDbDate(unit.sold_at))
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="p-3 text-slate-300">
                  {unit.client_name ?? (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="p-3">
                  <span
                    data-testid={`phone-unit-warranty-${unit.id}`}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="p-3 text-end">
                  {unit.status === "IN_STOCK" ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(unit);
                      }}
                      disabled={deleteUnit.isPending}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors disabled:opacity-50"
                      title={t("unit.remove")}
                      aria-label={t("unit.removeAria", { imei: unit.imei })}
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
          <span
            className="text-sm text-slate-400"
            data-testid="phone-units-range"
          >
            {t("phoneUnits.rangeUnits", { range: range.label })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="phone-units-prev"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={!range.hasPrev}
              aria-label={t("phoneUnits.prev")}
              className="p-1.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <DirIcon icon={ChevronLeft} width={16} height={16} />
            </button>
            <button
              type="button"
              data-testid="phone-units-next"
              onClick={() => setPage((p) => p + 1)}
              disabled={!range.hasNext}
              aria-label={t("phoneUnits.next")}
              className="p-1.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <DirIcon icon={ChevronRight} width={16} height={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

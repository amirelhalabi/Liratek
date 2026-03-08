import React, { useRef, useMemo, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type SortingState,
  type ColumnDef,
  type ColumnResizeMode,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ExportBar } from "./ExportBar";
import type { TableData } from "../utils/tableExport";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type SortDirection = "asc" | "desc";

export interface DataTableColumn {
  /** Header label / node */
  header: React.ReactNode;
  /** Per-column `<th>` className (overrides thClassName default) */
  className?: string;
  /** Column width in pixels (e.g. 120) — passed to TanStack size */
  width?: string;
  /**
   * Sort key — must match a key of the data items (or be resolved via
   * `getSortValue`). When provided the column becomes sortable.
   */
  sortKey?: string;
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: (string | DataTableColumn)[];
  /** Full data array */
  data: T[];
  /** Render function for each visible row — must return a `<tr>` */
  renderRow: (item: T, index: number) => React.ReactNode;

  // ── Select-all checkbox ──────────────────────────────────────────────
  /**
   * When provided, the first column header is replaced with a checkbox.
   * `checked`    — true when all items across ALL pages are selected
   * `indeterminate` — true when some (but not all) are selected
   * `onChange`   — called with true = select all, false = deselect all
   */
  selectAll?: {
    checked: boolean;
    indeterminate: boolean;
    onChange: (checked: boolean) => void;
  };

  // ── Export ──────────────────────────────────────────────────────────
  exportExcel?: boolean;
  exportPdf?: boolean;
  exportFilename?: string;

  // ── Header actions ─────────────────────────────────────────────────
  /** Content rendered on the left side of the header bar (e.g. batch action buttons). */
  headerActions?: React.ReactNode;

  // ── State ───────────────────────────────────────────────────────────
  loading?: boolean;
  emptyMessage?: string;
  emptyContent?: React.ReactNode;
  /** Extra rows rendered inside `<tbody>` after data rows (e.g. totals) */
  footerContent?: React.ReactNode;

  // ── Sorting ─────────────────────────────────────────────────────────
  /**
   * Custom value extractor for sort comparisons.
   * `(item, sortKey) => string | number`
   */
  getSortValue?: (item: T, key: string) => string | number;
  /** Initial sort column key */
  defaultSortKey?: string;
  /** Initial sort direction (default: "asc") */
  defaultSortDirection?: SortDirection;

  // ── Pagination ──────────────────────────────────────────────────────
  /** Enable built-in pagination (default: false) */
  paginate?: boolean;
  /** Rows per page (default: 20) */
  pageSize?: number;
  /** Label shown in pagination footer e.g. "products" (default: "rows") */
  pageLabel?: string;

  // ── Column resizing ─────────────────────────────────────────────────
  /** Enable drag-to-resize columns (default: false) */
  resizable?: boolean;

  // ── Shift-select ─────────────────────────────────────────────────────
  /**
   * When provided, DataTable intercepts Shift+Click on rows and calls
   * this handler with the contiguous range [fromIndex, toIndex] (inclusive,
   * in ascending order) based on the *visible* (sorted/paginated) row order.
   *
   * The handler should update the caller's selection state so that exactly
   * the rows in that range become selected (replacing any previous shift-range,
   * while preserving the anchor row as the fixed end of future shift-clicks).
   *
   * `fromIndex` and `toIndex` are indices into the current `data` array as
   * seen after sorting/pagination (i.e. the same index passed to `renderRow`).
   */
  onShiftSelect?: (fromIndex: number, toIndex: number) => void;
  /** Called when the user makes a plain (non-shift) click, resetting the anchor */
  onAnchorReset?: () => void;

  /**
   * Called whenever the visible (sorted + paginated) row order changes,
   * with the items in display order. Useful for callers that need to know
   * the sorted order for range-select operations.
   */
  onVisibleRowsChange?: (items: T[]) => void;

  // ── Styling ─────────────────────────────────────────────────────────
  className?: string;
  theadClassName?: string;
  thClassName?: string;
  tbodyClassName?: string;
}

/* ------------------------------------------------------------------ */
/*  Internal: proxy row type                                           */
/* ------------------------------------------------------------------ */

/**
 * We wrap each data item in a proxy row so TanStack can sort on
 * virtual `sortKey` columns that may not literally exist on T.
 */
interface ProxyRow<T> {
  __original: T;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const columnResizeMode: ColumnResizeMode = "onChange";

function DataTableInner<T>({
  columns: colDefs,
  data,
  renderRow,
  selectAll,
  exportExcel = false,
  exportPdf = false,
  exportFilename = "export",
  headerActions,
  loading = false,
  emptyMessage = "No data",
  emptyContent,
  footerContent,
  getSortValue,
  defaultSortKey,
  defaultSortDirection = "asc",
  paginate = false,
  pageSize = 20,
  pageLabel = "rows",
  resizable = false,
  className = "w-full text-left",
  theadClassName = "bg-slate-900 text-slate-400 text-xs uppercase",
  thClassName = "p-2",
  tbodyClassName,
  onShiftSelect,
  onVisibleRowsChange,
  onAnchorReset,
}: DataTableProps<T>) {
  const tableRef = useRef<HTMLTableElement>(null);
  /**
   * The anchor index (visible-row index) from the last plain click.
   * Shift+clicks extend the selection from this anchor.
   */
  const anchorIndexRef = useRef<number | null>(null);

  // ── Build proxy rows so TanStack can access sortKey values ──────────
  const proxyRows = useMemo<ProxyRow<T>[]>(() => {
    return data.map((item) => {
      const proxy: ProxyRow<T> = { __original: item };
      colDefs.forEach((col) => {
        if (typeof col !== "string" && col.sortKey) {
          const key = col.sortKey;
          const val = getSortValue
            ? getSortValue(item, key)
            : ((item as Record<string, unknown>)[key] ?? "");
          proxy[key] = val;
        }
      });
      return proxy;
    });
  }, [data, colDefs, getSortValue]);

  // ── Build TanStack column definitions ───────────────────────────────
  // We use a plain string id for each column so TanStack can manage
  // sorting state. The actual header ReactNode is rendered directly from
  // colDefs (not via flexRender) to support arbitrary JSX headers.
  const tanstackCols = useMemo<ColumnDef<ProxyRow<unknown>>[]>(() => {
    return colDefs.map((col, i) => {
      const sortKey = typeof col !== "string" ? col.sortKey : undefined;
      const widthStr = typeof col !== "string" ? col.width : undefined;
      const sizeNum = widthStr ? parseInt(widthStr) : undefined;

      if (sortKey) {
        const accessorCol: ColumnDef<ProxyRow<unknown>> = {
          id: sortKey,
          accessorKey: sortKey,
          header: sortKey,
          enableSorting: true,
          cell: () => null,
          ...(sizeNum ? { size: sizeNum } : {}),
        };
        return accessorCol;
      }

      const displayCol: ColumnDef<ProxyRow<unknown>> = {
        id: `col_${i}`,
        header: `col_${i}`,
        enableSorting: false,
        cell: () => null,
        ...(sizeNum ? { size: sizeNum } : {}),
      };
      return displayCol;
    });
  }, [colDefs]);

  // ── Initial sort state ───────────────────────────────────────────────
  const initialSorting: SortingState = useMemo(() => {
    if (!defaultSortKey) return [];
    return [{ id: defaultSortKey, desc: defaultSortDirection === "desc" }];
  }, [defaultSortKey, defaultSortDirection]);

  // ── TanStack table instance ──────────────────────────────────────────
  const table = useReactTable({
    data: proxyRows as ProxyRow<unknown>[],
    columns: tanstackCols,
    columnResizeMode,
    enableColumnResizing: resizable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(paginate ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    initialState: {
      sorting: initialSorting,
      ...(paginate ? { pagination: { pageIndex: 0, pageSize } } : {}),
    },
  });

  // ── Visible rows → map back to original T ───────────────────────────
  const visibleRows = table.getRowModel().rows;
  const colCount = colDefs.length;

  // Notify caller of current visible order whenever it changes
  const visibleItems = useMemo(
    () => visibleRows.map((r) => r.original.__original as T),
    [visibleRows],
  );
  const onVisibleRowsChangeRef = useRef(onVisibleRowsChange);
  onVisibleRowsChangeRef.current = onVisibleRowsChange;
  // Use layout effect to notify after render
  React.useEffect(() => {
    onVisibleRowsChangeRef.current?.(visibleItems);
  }, [visibleItems]);

  /**
   * Row click handler — only active when `onShiftSelect` is provided.
   * - Plain click  → set anchor, no range action
   * - Shift+click  → emit range [anchor, clicked] (sorted ascending)
   *                  anchor stays fixed for subsequent shift-clicks
   */
  const handleRowClick = useCallback(
    (e: React.MouseEvent, visibleIndex: number) => {
      if (!onShiftSelect) return;

      if (e.shiftKey && anchorIndexRef.current !== null) {
        const from = Math.min(anchorIndexRef.current, visibleIndex);
        const to = Math.max(anchorIndexRef.current, visibleIndex);
        onShiftSelect(from, to);
        // Do NOT update the anchor on shift-click — it stays at the original click
      } else {
        // Plain click: update anchor, reset any previous shift-range
        anchorIndexRef.current = visibleIndex;
        onAnchorReset?.();
      }
    },
    [onShiftSelect, onAnchorReset],
  );

  const thCls = (col: string | DataTableColumn) =>
    typeof col === "string" ? thClassName : (col.className ?? thClassName);

  // ── Build export data from ALL sorted rows (ignores pagination) ─────

  /**
   * Recursively extract text content from a React element tree.
   * Returns the concatenated text of all string/number children.
   */
  const extractText = useCallback((node: React.ReactNode): string => {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractText).join("");
    if (React.isValidElement(node)) {
      const { children } = node.props as { children?: React.ReactNode };
      return extractText(children);
    }
    return "";
  }, []);

  /**
   * Walk a React element tree and collect each `<td>` child's text content
   * into an array of strings. Handles both plain `<tr>` elements and
   * Fragment-wrapped rows (e.g. expandable rows that return <>
   *   <tr>...</tr><tr>...</tr>
   * </>). In the Fragment case only the first `<tr>` is used for export.
   */
  const extractCells = useCallback(
    (element: React.ReactElement): string[] => {
      // Find the target <tr>: if the element itself is a <tr>, use it directly.
      // Otherwise (e.g. Fragment), look for the first <tr> among its children.
      let tr: React.ReactElement | null = null;
      if (element.type === "tr") {
        tr = element;
      } else {
        const { children } = element.props as { children?: React.ReactNode };
        React.Children.forEach(children, (child) => {
          if (!tr && React.isValidElement(child) && child.type === "tr") {
            tr = child;
          }
        });
      }
      if (!tr) return [];

      const cells: string[] = [];
      const { children } = (tr as React.ReactElement).props as {
        children?: React.ReactNode;
      };
      React.Children.forEach(children, (child) => {
        if (!React.isValidElement(child)) return;
        if (child.type === "td") {
          cells.push(extractText(child).trim());
        }
      });
      return cells;
    },
    [extractText],
  );

  const getExportData = useCallback((): TableData => {
    // 1. Build headers, tracking which column indices to exclude
    const excludedIndices = new Set<number>();
    const headers: string[] = [];

    colDefs.forEach((col, i) => {
      const headerLabel = typeof col === "string" ? col : (col.header ?? "");
      const headerStr =
        typeof headerLabel === "string" ? headerLabel.trim().toLowerCase() : "";
      const isCheckboxCol = i === 0 && !!selectAll;
      const isActionCol = headerStr === "actions" || headerStr === "action";

      if (isCheckboxCol || isActionCol) {
        excludedIndices.add(i);
      } else {
        const text = typeof headerLabel === "string" ? headerLabel.trim() : "";
        headers.push(text);
      }
    });

    // 2. Get ALL rows (sorted, ignoring pagination) and extract cell text
    const allRows = table.getSortedRowModel().rows;
    const rows: string[][] = [];

    for (const row of allRows) {
      const item = row.original.__original as T;
      const rendered = renderRow(item, row.index);
      if (!rendered || !React.isValidElement(rendered)) continue;

      const cells = extractCells(rendered as React.ReactElement);
      const rowData: string[] = [];
      cells.forEach((text, i) => {
        if (!excludedIndices.has(i)) {
          rowData.push(text);
        }
      });
      rows.push(rowData);
    }

    return { headers, rows };
  }, [colDefs, selectAll, table, renderRow, extractCells]);

  return (
    <>
      <ExportBar
        exportExcel={exportExcel}
        exportPdf={exportPdf}
        exportFilename={exportFilename}
        tableRef={tableRef}
        getExportData={getExportData}
        rowCount={data.length}
        headerActions={headerActions}
      />

      <table
        ref={tableRef}
        className={className}
        style={resizable ? { tableLayout: "fixed" } : undefined}
      >
        <thead className={theadClassName}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header, i) => {
                const colDef = colDefs[i];
                const isSortable = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const widthStr =
                  typeof colDef !== "string" ? colDef?.width : undefined;
                // Render header label directly from colDef (supports ReactNode)
                const isFirstCol = i === 0;
                const headerLabel =
                  typeof colDef === "string" ? colDef : (colDef?.header ?? "");

                // Determine if this column should be excluded from exports
                const headerStr =
                  typeof headerLabel === "string"
                    ? headerLabel.trim().toLowerCase()
                    : "";
                const isCheckboxCol = isFirstCol && !!selectAll;
                const isActionCol =
                  headerStr === "actions" || headerStr === "action";
                const exportIgnore = isCheckboxCol || isActionCol;

                return (
                  <th
                    key={header.id}
                    className={`${thCls(colDef ?? "")} relative select-none overflow-hidden`}
                    {...(exportIgnore ? { "data-export-ignore": "true" } : {})}
                    style={
                      resizable
                        ? { width: header.getSize() }
                        : widthStr
                          ? { width: widthStr }
                          : undefined
                    }
                  >
                    {/* If selectAll is provided, replace first column header with checkbox */}
                    {isFirstCol && selectAll ? (
                      <input
                        type="checkbox"
                        checked={selectAll.checked}
                        ref={(el) => {
                          if (el) el.indeterminate = selectAll.indeterminate;
                        }}
                        onChange={(e) => selectAll.onChange(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-violet-600 cursor-pointer"
                        title="Select all (all pages)"
                      />
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 ${isSortable ? "cursor-pointer hover:text-slate-200" : ""}`}
                        onClick={
                          isSortable
                            ? header.column.getToggleSortingHandler()
                            : undefined
                        }
                      >
                        {headerLabel}
                        {isSortable && (
                          <>
                            {sorted === "asc" && (
                              <span className="text-blue-400 text-[10px]">
                                ▲
                              </span>
                            )}
                            {sorted === "desc" && (
                              <span className="text-blue-400 text-[10px]">
                                ▼
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    )}

                    {/* Drag-to-resize handle */}
                    {resizable && (
                      <span
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        className={`absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-500/50 ${
                          header.column.getIsResizing() ? "bg-blue-500/50" : ""
                        }`}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        <tbody className={tbodyClassName}>
          {loading ? (
            <tr>
              <td colSpan={colCount} className="p-4 text-center text-slate-500">
                Loading…
              </td>
            </tr>
          ) : visibleRows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="p-4 text-center text-slate-500">
                {emptyContent ?? emptyMessage}
              </td>
            </tr>
          ) : (
            visibleRows.map((row, index) => {
              const rendered = renderRow(row.original.__original as T, index);
              if (!onShiftSelect || !React.isValidElement(rendered)) {
                return rendered;
              }
              // Wrap the rendered <tr> with a click handler that captures
              // shift-clicks without interfering with existing row onClick
              const existing = (
                rendered.props as { onClick?: React.MouseEventHandler }
              ).onClick;
              return React.cloneElement(
                rendered as React.ReactElement<
                  React.HTMLAttributes<HTMLTableRowElement>
                >,
                {
                  onClick: (e: React.MouseEvent<HTMLTableRowElement>) => {
                    handleRowClick(e, index);
                    existing?.(e);
                  },
                  style: {
                    ...(
                      rendered.props as React.HTMLAttributes<HTMLTableRowElement>
                    ).style,
                  },
                },
              );
            })
          )}
          {footerContent}
        </tbody>
      </table>

      {/* ── Pagination footer ──────────────────────────────────────── */}
      {paginate && data.length > pageSize && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 bg-slate-800/50">
          <span className="text-sm text-slate-400">
            Showing {table.getState().pagination.pageIndex * pageSize + 1}–
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * pageSize,
              table.getFilteredRowModel().rows.length,
            )}{" "}
            of {table.getFilteredRowModel().rows.length} {pageLabel}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-1.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-slate-300 min-w-[5rem] text-center">
              {table.getState().pagination.pageIndex + 1} /{" "}
              {table.getPageCount()}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-1.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Memoized export — prevents re-renders when parent state changes but
 * props haven't. Cast preserves the generic type parameter since
 * React.memo() does not support generics natively.
 */
const MemoizedDataTable = React.memo(DataTableInner) as typeof DataTableInner;
export { MemoizedDataTable as DataTable };

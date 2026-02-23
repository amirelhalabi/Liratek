import React, { useRef } from "react";
import { ExportBar } from "./ExportBar";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DataTableColumn {
  header: React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  /** Column headers — strings for simple headers, or objects for per-column className */
  columns: (string | DataTableColumn)[];
  /** Data array */
  data: T[];
  /** Render function for each data row — should return a `<tr>` element */
  renderRow: (item: T, index: number) => React.ReactNode;

  /** Show an Excel (.xlsx) export button */
  exportExcel?: boolean;
  /** Show a PDF export button */
  exportPdf?: boolean;
  /** Base filename for downloads (without extension) */
  exportFilename?: string;

  /** Show loading placeholder instead of rows */
  loading?: boolean;
  /** Message when data is empty (default: "No data") */
  emptyMessage?: string;
  /** Custom empty state content (takes precedence over emptyMessage) */
  emptyContent?: React.ReactNode;
  /** Content rendered after data rows inside `<tbody>` (e.g. totals row) */
  footerContent?: React.ReactNode;

  /** `<table>` className (default: `"w-full text-left"`) */
  className?: string;
  /** `<thead>` className (default: `"bg-slate-900 text-slate-400 text-xs uppercase"`) */
  theadClassName?: string;
  /** Default className for every `<th>` cell (default: `"p-2"`) */
  thClassName?: string;
  /** `<tbody>` className */
  tbodyClassName?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Reusable table component that wraps ExportBar + `<table>` into a single
 * component. Manages the table ref internally, renders column headers from
 * `columns`, handles loading/empty states, and delegates row rendering to
 * the consumer via `renderRow`.
 */
export function DataTable<T>({
  columns,
  data,
  renderRow,
  exportExcel = false,
  exportPdf = false,
  exportFilename = "export",
  loading = false,
  emptyMessage = "No data",
  emptyContent,
  footerContent,
  className = "w-full text-left",
  theadClassName = "bg-slate-900 text-slate-400 text-xs uppercase",
  thClassName = "p-2",
  tbodyClassName,
}: DataTableProps<T>) {
  const tableRef = useRef<HTMLTableElement>(null);
  const colCount = columns.length;

  return (
    <>
      <ExportBar
        exportExcel={exportExcel}
        exportPdf={exportPdf}
        exportFilename={exportFilename}
        tableRef={tableRef}
        rowCount={data.length}
      />
      <table ref={tableRef} className={className}>
        <thead className={theadClassName}>
          <tr>
            {columns.map((col, i) => {
              const header = typeof col === "string" ? col : col.header;
              const cls =
                typeof col === "string"
                  ? thClassName
                  : (col.className ?? thClassName);
              return (
                <th key={i} className={cls}>
                  {header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={tbodyClassName}>
          {loading ? (
            <tr>
              <td colSpan={colCount} className="p-4 text-center text-slate-500">
                Loading…
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="p-4 text-center text-slate-500">
                {emptyContent ?? emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item, index) => renderRow(item, index))
          )}
          {footerContent}
        </tbody>
      </table>
    </>
  );
}

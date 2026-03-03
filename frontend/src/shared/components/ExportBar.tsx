import React, { useCallback } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import {
  exportToExcel,
  exportToPdf,
  type TableData,
} from "../../shared/utils/tableExport";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ExportableTableProps {
  /** Show an Excel (.xlsx) export button */
  exportExcel?: boolean | undefined;
  /** Show a PDF export button */
  exportPdf?: boolean | undefined;
  /** Base filename (without extension) used for the downloaded file */
  exportFilename?: string | undefined;
  /** Number of data rows — when 0, the export bar is hidden */
  rowCount?: number | undefined;
}

export interface ExportBarProps {
  exportExcel: boolean;
  exportPdf: boolean;
  exportFilename?: string | undefined;
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** When provided, this callback supplies ALL rows (ignoring pagination). */
  getExportData?: () => TableData;
  rowCount?: number | undefined;
  /** Optional content rendered on the left side of the bar (e.g. batch action buttons). */
  headerActions?: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Renders Excel / PDF export buttons above a table.
 * Hidden when both `exportExcel` and `exportPdf` are `false`.
 */
export function ExportBar({
  exportExcel,
  exportPdf,
  exportFilename = "export",
  tableRef,
  getExportData,
  rowCount,
  headerActions,
}: ExportBarProps) {
  const handleExcel = useCallback(() => {
    if (getExportData) {
      exportToExcel(getExportData(), exportFilename);
    } else if (tableRef.current) {
      exportToExcel(tableRef.current, exportFilename);
    }
  }, [tableRef, exportFilename, getExportData]);

  const handlePdf = useCallback(() => {
    if (getExportData) {
      exportToPdf(getExportData(), exportFilename);
    } else if (tableRef.current) {
      exportToPdf(tableRef.current, exportFilename);
    }
  }, [tableRef, exportFilename, getExportData]);

  const hasExport =
    (exportExcel || exportPdf) && (rowCount === undefined || rowCount > 0);
  if (!hasExport && !headerActions) return null;

  return (
    <div className="flex items-center justify-between px-1 py-1">
      {/* Left: consumer-provided actions (e.g. batch buttons) */}
      <div className="flex items-center gap-1">{headerActions}</div>

      {/* Right: export buttons */}
      {hasExport && (
        <div className="flex items-center gap-1">
          {exportExcel && (
            <button
              type="button"
              onClick={handleExcel}
              title="Export to Excel"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-600/30 transition-colors cursor-pointer"
            >
              <FileSpreadsheet size={14} />
              Excel
            </button>
          )}
          {exportPdf && (
            <button
              type="button"
              onClick={handlePdf}
              title="Export to PDF"
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors cursor-pointer"
            >
              <FileText size={14} />
              PDF
            </button>
          )}
        </div>
      )}
    </div>
  );
}

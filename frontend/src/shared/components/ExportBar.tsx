import React, { useCallback } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel, exportToPdf } from "../../shared/utils/tableExport";

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
  rowCount?: number | undefined;
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
  rowCount,
}: ExportBarProps) {
  const handleExcel = useCallback(() => {
    if (tableRef.current) exportToExcel(tableRef.current, exportFilename);
  }, [tableRef, exportFilename]);

  const handlePdf = useCallback(() => {
    if (tableRef.current) exportToPdf(tableRef.current, exportFilename);
  }, [tableRef, exportFilename]);

  if (!exportExcel && !exportPdf) return null;
  if (rowCount !== undefined && rowCount === 0) return null;

  return (
    <div className="flex items-center gap-1 justify-end px-1 py-1">
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
  );
}

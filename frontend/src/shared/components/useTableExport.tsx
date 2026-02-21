import { useRef } from "react";
import { ExportBar, type ExportableTableProps } from "./ExportBar";

/* ------------------------------------------------------------------ */
/*  Hook – creates a ref + provides the ExportBar ready to render      */
/* ------------------------------------------------------------------ */

/**
 * Convenience hook that creates a table ref and returns:
 *  - `tableRef`  → attach to the `<table>` element
 *  - `ExportBarComponent` → render above the table
 */
export function useTableExport(
  props: ExportableTableProps & { filename?: string | undefined },
) {
  const tableRef = useRef<HTMLTableElement>(null);
  const {
    exportExcel = false,
    exportPdf = false,
    filename = "export",
    rowCount,
  } = props;

  const bar = (
    <ExportBar
      exportExcel={exportExcel}
      exportPdf={exportPdf}
      exportFilename={filename}
      tableRef={tableRef}
      rowCount={rowCount}
    />
  );

  return { tableRef, ExportBarComponent: bar } as const;
}

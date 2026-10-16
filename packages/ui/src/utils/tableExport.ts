/**
 * Utility functions for exporting table data to Excel and PDF.
 *
 * Both helpers accept either:
 *   - a pre-built `TableData` object (headers + rows), OR
 *   - a ref to the `<table>` DOM element (legacy fallback).
 *
 * Using `TableData` directly is preferred because it exports ALL rows
 * regardless of pagination, whereas DOM scraping only captures the
 * currently rendered page.
 */

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { saveAs } from "file-saver";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/** An extra worksheet appended after the main one (Excel only). */
export interface ExportSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

export interface TableData {
  headers: string[];
  rows: string[][];
  /** Main worksheet name. Default "Sheet1". */
  sheetName?: string;
  /**
   * One long text per row (index-aligned with `rows`; "" = none). Excel: a
   * last column titled `header`. PDF: a full-width wrapped line under the
   * row, so long text does not squeeze the other columns.
   */
  rowNotes?: { header: string; values: string[] };
  /** Further worksheets after the main one (Excel only). */
  extraSheets?: ExportSheet[];
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function extractTableData(table: HTMLTableElement): TableData {
  const headers: string[] = [];
  const rows: string[][] = [];

  // Determine which column indices to exclude (checkbox, action columns)
  const excludedIndices = new Set<number>();

  // Extract headers from <thead>
  const thead = table.querySelector("thead");
  if (thead) {
    const headerCells = thead.querySelectorAll("th");
    headerCells.forEach((th, i) => {
      if (th.hasAttribute("data-export-ignore")) {
        excludedIndices.add(i);
        return;
      }
      const text = th.textContent?.trim() ?? "";
      headers.push(text);
    });
  }

  // Extract body rows from <tbody>
  const tbody = table.querySelector("tbody");
  if (tbody) {
    const trs = tbody.querySelectorAll("tr");
    trs.forEach((tr) => {
      // Skip nested tables' rows and empty‑state rows
      if (tr.closest("tbody") !== tbody) return;
      const cells = tr.querySelectorAll("td");
      if (cells.length === 0) return;

      // Skip rows that span the full width (empty states / "no data" placeholders)
      if (cells.length === 1 && cells[0].hasAttribute("colspan")) return;

      const row: string[] = [];
      cells.forEach((td, i) => {
        if (excludedIndices.has(i)) return;
        row.push(td.textContent?.trim() ?? "");
      });
      rows.push(row);
    });
  }

  return { headers, rows };
}

/** Resolve input to a `TableData` object. */
function resolveTableData(source: HTMLTableElement | TableData): TableData {
  if ("headers" in source && "rows" in source) return source;
  return extractTableData(source);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Export table data to an .xlsx Excel file.
 *
 * @param source  Pre-built `TableData` or an HTML `<table>` element.
 * @param filename  Base filename (without extension).
 */
function buildSheet(headers: string[], rows: string[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Auto‑size columns based on content width
  ws["!cols"] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length));
    return { wch: Math.min(maxLen + 2, 40) };
  });
  return ws;
}

/** The workbook `exportToExcel` saves — separate so it can be tested. */
export function buildExcelWorkbook(data: TableData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const notes = data.rowNotes;
  const headers = notes ? [...data.headers, notes.header] : data.headers;
  const rows = notes
    ? data.rows.map((r, i) => [...r, notes.values[i] ?? ""])
    : data.rows;
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(headers, rows),
    data.sheetName ?? "Sheet1",
  );
  for (const sheet of data.extraSheets ?? []) {
    XLSX.utils.book_append_sheet(
      wb,
      buildSheet(sheet.headers, sheet.rows),
      sheet.name,
    );
  }
  return wb;
}

export function exportToExcel(
  source: HTMLTableElement | TableData,
  filename = "export",
): void {
  const wb = buildExcelWorkbook(resolveTableData(source));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `${filename}.xlsx`);
}

/** The PDF table body `exportToPdf` draws — separate so it can be tested. */
export function buildPdfBody(data: TableData): RowInput[] {
  const notes = data.rowNotes;
  if (!notes) return data.rows;
  const body: RowInput[] = [];
  data.rows.forEach((row, i) => {
    body.push(row);
    const note = notes.values[i] ?? "";
    if (note === "") return;
    body.push([
      {
        content: note,
        colSpan: data.headers.length,
        // Explicit fill so the note never takes the alternate-row stripe of
        // a different row than the one it belongs to.
        styles: {
          fontSize: 7,
          textColor: [75, 85, 99],
          fillColor: [255, 255, 255],
          cellPadding: { top: 1, right: 4, bottom: 4, left: 14 },
        },
      },
    ]);
  });
  return body;
}

/**
 * Export table data to a PDF file.
 *
 * @param source  Pre-built `TableData` or an HTML `<table>` element.
 * @param filename  Base filename (without extension).
 */
export function exportToPdf(
  source: HTMLTableElement | TableData,
  filename = "export",
): void {
  const data = resolveTableData(source);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  // Title
  doc.setFontSize(14);
  doc.text(filename, 40, 30);

  autoTable(doc, {
    startY: 45,
    head: [data.headers],
    body: buildPdfBody(data),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: {
      fillColor: [31, 41, 55], // gray-800
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [243, 244, 246] },
    margin: { left: 30, right: 30 },
  });

  doc.save(`${filename}.pdf`);
}

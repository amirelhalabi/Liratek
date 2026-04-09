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
import autoTable from "jspdf-autotable";
import { saveAs } from "file-saver";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface TableData {
  headers: string[];
  rows: string[][];
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
export function exportToExcel(
  source: HTMLTableElement | TableData,
  filename = "export",
): void {
  const { headers, rows } = resolveTableData(source);
  const worksheetData = [headers, ...rows];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(worksheetData);

  // Auto‑size columns based on content width
  ws["!cols"] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length));
    return { wch: Math.min(maxLen + 2, 40) };
  });

  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `${filename}.xlsx`);
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
  const { headers, rows } = resolveTableData(source);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  // Title
  doc.setFontSize(14);
  doc.text(filename, 40, 30);

  autoTable(doc, {
    startY: 45,
    head: [headers],
    body: rows,
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

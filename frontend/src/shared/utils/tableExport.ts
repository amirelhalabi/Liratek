/**
 * Utility functions for exporting HTML table data to Excel and PDF.
 *
 * Both helpers accept a ref to the `<table>` element and extract
 * header + body data from the DOM so callers don't need to pass
 * column definitions or row arrays.
 */

import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { saveAs } from "file-saver";

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

interface TableData {
  headers: string[];
  rows: string[][];
}

function extractTableData(table: HTMLTableElement): TableData {
  const headers: string[] = [];
  const rows: string[][] = [];

  // Extract headers from <thead>
  const thead = table.querySelector("thead");
  if (thead) {
    const headerCells = thead.querySelectorAll("th");
    headerCells.forEach((th) => {
      const text = th.textContent?.trim() ?? "";
      // Skip empty header cells (e.g. action columns, expand icons)
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
      cells.forEach((td) => {
        row.push(td.textContent?.trim() ?? "");
      });
      rows.push(row);
    });
  }

  return { headers, rows };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Export an HTML <table> element to an .xlsx Excel file.
 */
export function exportToExcel(
  table: HTMLTableElement,
  filename = "export",
): void {
  const { headers, rows } = extractTableData(table);
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
 * Export an HTML <table> element to a PDF file.
 */
export function exportToPdf(
  table: HTMLTableElement,
  filename = "export",
): void {
  const { headers, rows } = extractTableData(table);

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

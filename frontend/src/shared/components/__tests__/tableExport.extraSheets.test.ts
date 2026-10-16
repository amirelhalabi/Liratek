/**
 * Owner decision 2026-10-16 — the shared export util can add a long-text
 * column per row ("Details") and extra worksheets, without changing any
 * other page's export. Runs the REAL builders and reads the workbook back
 * with `xlsx` (rule 28: running, not reading). Written before the builders
 * learnt the new fields and seen failing (rule 17).
 */
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  buildExcelWorkbook,
  buildPdfBody,
  type TableData,
} from "../../../../../packages/ui/src/utils/tableExport";

function roundTrip(data: TableData): XLSX.WorkBook {
  const buf: Buffer = XLSX.write(buildExcelWorkbook(data), {
    bookType: "xlsx",
    type: "buffer",
  });
  return XLSX.read(buf, { type: "buffer" });
}

function sheetRows(wb: XLSX.WorkBook, name: string): string[][] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`no sheet ${name}`);
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
}

const plain: TableData = {
  headers: ["Name", "Amount"],
  rows: [
    ["Plain", "$5"],
    ["Other", "$7"],
  ],
};

describe("buildExcelWorkbook", () => {
  it("a plain table is unchanged: one Sheet1 with headers + rows", () => {
    const wb = roundTrip(plain);
    expect(wb.SheetNames).toEqual(["Sheet1"]);
    expect(sheetRows(wb, "Sheet1")).toEqual([
      ["Name", "Amount"],
      ["Plain", "$5"],
      ["Other", "$7"],
    ]);
  });

  it("names the main sheet, adds the notes column and the extra sheets", () => {
    const wb = roundTrip({
      ...plain,
      sheetName: "Transactions",
      rowNotes: { header: "Details", values: ["Reference: R-1", ""] },
      extraSheets: [
        { name: "Details", headers: ["Txn #", "Field"], rows: [["1", "Ref"]] },
        { name: "Payments", headers: ["Txn #"], rows: [] },
      ],
    });
    expect(wb.SheetNames).toEqual(["Transactions", "Details", "Payments"]);
    expect(sheetRows(wb, "Transactions")).toEqual([
      ["Name", "Amount", "Details"],
      ["Plain", "$5", "Reference: R-1"],
      ["Other", "$7", ""],
    ]);
    expect(sheetRows(wb, "Details")).toEqual([
      ["Txn #", "Field"],
      ["1", "Ref"],
    ]);
    expect(sheetRows(wb, "Payments")).toEqual([["Txn #"]]);
  });
});

describe("buildPdfBody", () => {
  it("a plain table is unchanged", () => {
    expect(buildPdfBody(plain)).toEqual(plain.rows);
  });

  it("puts each non-empty note on its own full-width row under its row", () => {
    const body = buildPdfBody({
      ...plain,
      rowNotes: { header: "Details", values: ["Reference: R-1", ""] },
    });
    expect(body).toHaveLength(3);
    expect(body[0]).toEqual(["Plain", "$5"]);
    expect(body[1]).toEqual([
      expect.objectContaining({ content: "Reference: R-1", colSpan: 2 }),
    ]);
    expect(body[2]).toEqual(["Other", "$7"]);
  });

  it("jspdf-autotable really draws the note rows (landscape A4)", () => {
    const data: TableData = {
      ...plain,
      rowNotes: {
        header: "Details",
        values: ["Reference: R-1 · " + "Sender: Ali Saad · ".repeat(20), ""],
      },
    };
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a4",
    });
    autoTable(doc, { head: [data.headers], body: buildPdfBody(data) });
    const out = doc.output();
    expect(out).toContain("Reference: R-1");
    expect(out).toContain("Plain");
  });
});

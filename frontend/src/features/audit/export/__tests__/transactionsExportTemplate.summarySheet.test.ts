/**
 * LIRA-389 FR-007 — while the Summary view is shown, the Transactions
 * workbook gains a "Summary by <grouping>" sheet (the existing "Summary"
 * sheet keeps its name and content): the grouping's rows with Count, Units
 * (product / category only), Volume USD and Volume LBP, then the TOTAL row.
 * No profit, cost, margin or commission column. Read back from the written
 * .xlsx bytes (rule 28). Written before the template change (rule 17).
 */
import * as XLSX from "xlsx";
import { writeTemplateWorkbook } from "@liratek/ui";
import type { TransactionSummaryResult } from "@liratek/core";
import { shopDayRow } from "../../__fixtures__/shopDayRows";
import { transactionsExportTemplate } from "../transactionsExportTemplate";

const productSummary: TransactionSummaryResult = {
  group_by: "product",
  rows: [
    {
      key: "product:5",
      label: "Lenovo IdeaPad 3",
      count: 3,
      units: 3,
      volume_usd: 1335,
      volume_lbp: 0,
      product_id: 5,
      deleted: false,
    },
    {
      key: "product:9",
      label: "Old charger",
      count: 1,
      units: 2,
      volume_usd: 20,
      volume_lbp: 0,
      product_id: 9,
      deleted: true,
    },
  ],
  total: { count: 3, units: 5, volume_usd: 1355, volume_lbp: 0 },
  truncated: false,
};

function workbook(summary?: TransactionSummaryResult): XLSX.WorkBook {
  const sheets = transactionsExportTemplate({
    isAdmin: true,
    methodLabelByCode: new Map(),
    exportedBy: "Admin",
    filters: {
      from: "2026-11-01",
      to: "2026-11-30",
      search: "",
      types: ["Sale"],
    },
    summary,
  }).excel({ rows: [shopDayRow(10895)], now: new Date(2026, 10, 30, 18, 0) });
  return XLSX.read(writeTemplateWorkbook(sheets), { type: "array" });
}

function aoa(wb: XLSX.WorkBook, sheet: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet]!, {
    header: 1,
    defval: null,
    raw: true,
  });
}

describe("LIRA-389 — Summary-by sheet", () => {
  it("is added after the existing Summary sheet only when a summary is given", () => {
    expect(workbook().SheetNames).toEqual([
      "Summary",
      "Transactions",
      "Payments",
      "Details",
    ]);
    expect(workbook(productSummary).SheetNames).toEqual([
      "Summary",
      "Summary by Product",
      "Transactions",
      "Payments",
      "Details",
    ]);
  });

  it("lists the rows and the TOTAL, with no profit column", () => {
    const rows = aoa(workbook(productSummary), "Summary by Product").filter(
      (r) => r.some((c) => c !== null),
    );
    const header = rows.find((r) => r[0] === "Product")!;
    expect(header).toEqual([
      "Product",
      "Count",
      "Units",
      "Volume USD",
      "Volume LBP",
    ]);
    expect(header.join("|")).not.toMatch(/profit|cost|margin|commission/i);
    expect(rows).toContainEqual(["Lenovo IdeaPad 3", 3, 3, 1335, null]);
    expect(rows).toContainEqual(["Old charger (deleted)", 1, 2, 20, null]);
    expect(rows).toContainEqual(["TOTAL", 3, 5, 1355, null]);
  });

  it("Type / Service type sheets have no Units column", () => {
    const wb = workbook({
      group_by: "service",
      rows: [
        {
          key: "OMT System Send",
          label: "OMT System Send",
          count: 2,
          units: null,
          volume_usd: 202,
          volume_lbp: 0,
        },
      ],
      total: { count: 2, units: null, volume_usd: 202, volume_lbp: 0 },
      truncated: false,
    });
    const rows = aoa(wb, "Summary by Service type").filter((r) =>
      r.some((c) => c !== null),
    );
    expect(rows.find((r) => r[0] === "Service type")).toEqual([
      "Service type",
      "Count",
      "Volume USD",
      "Volume LBP",
    ]);
    expect(rows).toContainEqual(["TOTAL", 2, 202, null]);
  });
});

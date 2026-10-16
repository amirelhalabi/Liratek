/** @jest-environment jsdom */
/**
 * Owner decision 2026-10-16 — `DataTable` gained an optional
 * `exportTemplate`. A table WITHOUT one must export exactly as before.
 *
 * A characterisation test: written and run BEFORE the template work
 * touched DataTable / ExportBar / tableExport, with the values below
 * (export data, workbook hash, PDF body) recorded from that unchanged
 * code. It passes before and after by design — it is not a failing-first
 * test; it pins that the old path did not move.
 */
import { createHash } from "crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import * as XLSX from "xlsx";
import { DataTable, type DataTableColumn, type TableData } from "@liratek/ui";

const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("../../../../../packages/ui/src/utils/tableExport", () => ({
  ...jest.requireActual("../../../../../packages/ui/src/utils/tableExport"),
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));

// The REAL builders (not the mocked savers above).
const { buildExcelWorkbook, buildPdfBody } = jest.requireActual<
  typeof import("../../../../../packages/ui/src/utils/tableExport")
>("../../../../../packages/ui/src/utils/tableExport");

interface Row {
  id: number;
  name: string;
  amount: string;
  user: string;
}

const COLUMNS: DataTableColumn[] = [
  { header: "Time" },
  { header: "Name", sortKey: "name" },
  { header: "Amount" },
  { header: "User" },
  { header: "Actions" },
];

const ROWS: Row[] = [
  { id: 1, name: "Bravo", amount: "$5", user: "ali" },
  { id: 2, name: "Alpha", amount: "100,000 LBP", user: "maya" },
];

function renderRow(r: Row) {
  return (
    <tr key={r.id}>
      <td>10:0{r.id}</td>
      <td>{r.name}</td>
      <td>{r.amount}</td>
      <td>{r.user}</td>
      <td>
        <button type="button">Edit</button>
      </td>
    </tr>
  );
}

function renderTable() {
  render(
    <DataTable<Row>
      columns={COLUMNS}
      data={ROWS}
      renderRow={renderRow}
      defaultSortKey="name"
      defaultSortDirection="asc"
      exportExcel
      exportPdf
      exportFilename="things"
    />,
  );
}

// Recorded from the code before the template work (see the file doc).
const EXPECTED_DATA: TableData = {
  headers: ["Time", "User"],
  rows: [
    ["10:02", "maya"],
    ["10:01", "ali"],
  ],
};

function workbookHash(data: TableData): string {
  const buf = XLSX.write(buildExcelWorkbook(data), {
    bookType: "xlsx",
    type: "buffer",
    compression: false,
  }) as Buffer;
  return createHash("sha256").update(buf).digest("hex");
}

describe("DataTable without an export template — unchanged", () => {
  beforeEach(() => {
    exportToExcel.mockClear();
    exportToPdf.mockClear();
  });

  it("Excel gets the same TableData as before (default Time/User picker)", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("Export to Excel"));
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const [data, filename] = exportToExcel.mock.calls[0] as [TableData, string];
    expect(data).toEqual(EXPECTED_DATA);
    expect(Object.keys(data)).toEqual(["headers", "rows"]);
    expect(filename).toMatch(/^things-\d{2}-\d{2}-\d{4}$/);
  });

  it("PDF gets the same TableData as before", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("Export to PDF"));
    expect(exportToPdf).toHaveBeenCalledTimes(1);
    expect(exportToPdf.mock.calls[0][0]).toEqual(EXPECTED_DATA);
  });

  it("still offers the column picker", () => {
    renderTable();
    expect(screen.getByTestId("export-column-picker-button")).toBeTruthy();
  });

  it("the workbook bytes are identical to before (and deterministic)", () => {
    const first = workbookHash(EXPECTED_DATA);
    expect(workbookHash(EXPECTED_DATA)).toBe(first);
    expect(first).toBe(RECORDED_WORKBOOK_HASH);
  });

  it("the PDF body is identical to before", () => {
    expect(buildPdfBody(EXPECTED_DATA)).toEqual([
      ["10:02", "maya"],
      ["10:01", "ali"],
    ]);
  });
});

const RECORDED_WORKBOOK_HASH =
  "69a9d852f82c9ab144c3acc22094583c5e5e38e10104e4039f102b3ec007fa66";

/** @jest-environment jsdom */
/**
 * DataTable export — Fragment-wrapped rows (LIRA-067).
 *
 * Imports the REAL component from @liratek/ui (packages/ui/src/components/ui/
 * DataTable.tsx) — NOT the stale duplicate at frontend/src/shared/components/
 * DataTable.tsx that the sibling DataTable.test.tsx in this folder exercises
 * (that copy is unused by every page; every real consumer, including
 * TransactionsViewer, imports from @liratek/ui).
 *
 * A `renderRow`/`exportRow` can return a Fragment of multiple <tr>s (e.g. a
 * transaction row plus an indented payment-leg detail row). Before this fix,
 * getExportData's extractCells only read the FIRST <tr> in a Fragment,
 * silently dropping every extra row from Excel/PDF export.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { Fragment } from "react";
import { DataTable, type DataTableColumn } from "@liratek/ui";

// The REAL DataTable's ExportBar (packages/ui/src/components/ui/ExportBar.tsx)
// imports from packages/ui/src/utils/tableExport — a different module than
// frontend/src/shared/utils/tableExport, which only the stale duplicate uses.
const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));

interface Row {
  id: number;
  name: string;
  detail: string | null;
}

const NAME_COL: DataTableColumn = { header: "Name" };
const DETAIL_COL: DataTableColumn = { header: "Detail" };

const rows: Row[] = [
  { id: 1, name: "Plain Row", detail: null },
  { id: 2, name: "Split Payment Row", detail: "In — Cash: $30" },
];

function renderRow(item: Row) {
  const mainTr = (
    <tr key={item.id}>
      <td>{item.name}</td>
      <td></td>
    </tr>
  );
  if (!item.detail) return mainTr;
  return (
    <Fragment key={item.id}>
      {mainTr}
      <tr key={`${item.id}-detail`}>
        <td></td>
        <td>{item.detail}</td>
      </tr>
    </Fragment>
  );
}

describe("DataTable export — Fragment multi-<tr> rows", () => {
  beforeEach(() => {
    exportToExcel.mockClear();
    exportToPdf.mockClear();
  });

  it("exports every <tr> in a Fragment-wrapped row, not just the first", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL, DETAIL_COL]}
        data={rows}
        renderRow={renderRow}
        exportExcel
        exportFilename="txns"
      />,
    );

    fireEvent.click(screen.getByTitle("Export to Excel"));
    expect(exportToExcel).toHaveBeenCalledTimes(1);

    const [tableData] = exportToExcel.mock.calls[0] as [
      { headers: string[]; rows: string[][] },
      string,
    ];

    // Plain row (1 <tr>) + split-payment row's own <tr> + its detail <tr> = 3.
    expect(tableData.rows).toHaveLength(3);
    expect(tableData.rows).toContainEqual(["Plain Row", ""]);
    expect(tableData.rows).toContainEqual(["Split Payment Row", ""]);
    // The detail row is indented one column in: blank Name cell, text under Detail.
    expect(tableData.rows).toContainEqual(["", "In — Cash: $30"]);
  });
});

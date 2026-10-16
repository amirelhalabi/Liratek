/** @jest-environment jsdom */
/**
 * Owner decision 2026-10-16 — `DataTable`'s optional `exportTemplate`: with
 * one, Excel / PDF go to the template engine with EVERY row in the table's
 * current sort (not just the visible page), and the column picker (which a
 * template ignores) is hidden. Written after the wiring — not proven
 * failing-first; the no-template path is pinned by
 * DataTable.templateLessExport.test.tsx.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import {
  DataTable,
  type DataTableColumn,
  type ExportTemplate,
  type ExportTemplateContext,
} from "@liratek/ui";

const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));
const exportTemplateToExcel = jest.fn();
const exportTemplateToPdf = jest.fn();
jest.mock("../../../../../packages/ui/src/utils/exportTemplate", () => ({
  ...jest.requireActual("../../../../../packages/ui/src/utils/exportTemplate"),
  exportTemplateToExcel: (...args: unknown[]) => exportTemplateToExcel(...args),
  exportTemplateToPdf: (...args: unknown[]) => exportTemplateToPdf(...args),
}));

interface Row {
  id: number;
  name: string;
}

const COLUMNS: DataTableColumn[] = [{ header: "Name", sortKey: "name" }];
const ROWS: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  name: `Row ${String(30 - i).padStart(2, "0")}`,
}));

const TEMPLATE: ExportTemplate<Row> = {
  excel: () => [],
  pdf: () => ({
    title: "t",
    headerLines: [],
    summary: [],
    columns: [],
    groups: [],
  }),
};

function renderTable() {
  render(
    <DataTable<Row>
      columns={COLUMNS}
      data={ROWS}
      renderRow={(r) => (
        <tr key={r.id}>
          <td>{r.name}</td>
        </tr>
      )}
      defaultSortKey="name"
      defaultSortDirection="asc"
      paginate
      pageSize={10}
      exportExcel
      exportPdf
      exportFilename="things"
      exportTemplate={TEMPLATE}
    />,
  );
}

describe("DataTable with an export template", () => {
  beforeEach(() => jest.clearAllMocks());

  it("Excel: the template gets every row in the current sort", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("Export to Excel"));
    expect(exportToExcel).not.toHaveBeenCalled();
    const [template, ctx, filename] = exportTemplateToExcel.mock.calls[0] as [
      ExportTemplate<Row>,
      ExportTemplateContext<Row>,
      string,
    ];
    expect(template).toBe(TEMPLATE);
    expect(ctx.rows).toHaveLength(30);
    expect(ctx.rows[0]!.name).toBe("Row 01");
    expect(ctx.rows[29]!.name).toBe("Row 30");
    expect(ctx.now).toBeInstanceOf(Date);
    expect(filename).toMatch(/^things-\d{2}-\d{2}-\d{4}$/);
  });

  it("PDF goes to the template too", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("Export to PDF"));
    expect(exportToPdf).not.toHaveBeenCalled();
    expect(exportTemplateToPdf).toHaveBeenCalledTimes(1);
  });

  it("hides the column picker", () => {
    renderTable();
    expect(screen.queryByTestId("export-column-picker-button")).toBeNull();
  });
});

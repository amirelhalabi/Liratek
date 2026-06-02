/** @jest-environment jsdom */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "../DataTable";
// @testing-library/jest-dom matchers are loaded globally (jest.setup.ts) — no import needed.

/**
 * DataTable is a generic, TanStack-backed table. The original e2e specs
 * (S27–S34) drove it through real feature pages (Expenses / Custom Services /
 * Inventory / Loto). Those tests really exercised the component's own
 * behaviour: rendering rows, sorting, pagination, select-all, shift-select,
 * empty state and export buttons. We reproduce that ground here against the
 * component directly with synthetic data.
 */

// ── Mock the export utils so we don't pull in xlsx/jspdf and can assert calls.
const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("@/shared/utils/tableExport", () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));

interface Row {
  id: number;
  name: string;
  amount: number;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    amount: (i + 1) * 10,
  }));
}

const NAME_COL: DataTableColumn = { header: "Name", sortKey: "name" };
const AMOUNT_COL: DataTableColumn = { header: "Amount", sortKey: "amount" };

function renderRow(item: Row) {
  return (
    <tr key={item.id} data-testid={`row-${item.id}`}>
      <td>{item.name}</td>
      <td>{item.amount}</td>
    </tr>
  );
}

/** Visible data rows = every <tbody> <tr> that carries our row-<id> testid. */
function dataRows(): HTMLElement[] {
  const table = screen.getByTestId("data-table");
  return within(table)
    .getAllByRole("row")
    .filter((r) => r.getAttribute("data-testid")?.startsWith("row-"));
}

describe("DataTable", () => {
  beforeEach(() => {
    exportToExcel.mockClear();
    exportToPdf.mockClear();
  });

  // ── S27: render list → rows + columns appear ────────────────────────
  it("renders column headers and one row per data item", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={makeRows(3)}
        renderRow={renderRow}
      />,
    );

    expect(screen.getByTestId("data-table")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(dataRows()).toHaveLength(3);
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 3")).toBeInTheDocument();
  });

  it("supports plain string column definitions", () => {
    render(
      <DataTable<Row>
        columns={["Name", "Amount"]}
        data={makeRows(1)}
        renderRow={renderRow}
      />,
    );

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(dataRows()).toHaveLength(1);
  });

  // ── S33: empty state ────────────────────────────────────────────────
  it("renders the default empty message when there is no data", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={[]}
        renderRow={renderRow}
        emptyMessage="No expenses found"
      />,
    );

    expect(dataRows()).toHaveLength(0);
    expect(screen.getByText("No expenses found")).toBeInTheDocument();
  });

  it("renders custom empty content over the default message", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={[]}
        renderRow={renderRow}
        emptyMessage="No data"
        emptyContent={<span data-testid="custom-empty">Nothing here yet</span>}
      />,
    );

    expect(screen.getByTestId("custom-empty")).toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });

  it("renders a loading placeholder instead of rows when loading", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={makeRows(3)}
        renderRow={renderRow}
        loading
      />,
    );

    expect(dataRows()).toHaveLength(0);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  // ── S28: sort ascending / descending ────────────────────────────────
  it("sorts rows when a sortable header is clicked", () => {
    // Provide unsorted data; default order is insertion order.
    const data: Row[] = [
      { id: 1, name: "Charlie", amount: 30 },
      { id: 2, name: "Alpha", amount: 10 },
      { id: 3, name: "Bravo", amount: 20 },
    ];

    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={data}
        renderRow={renderRow}
      />,
    );

    const firstNameUnsorted = within(dataRows()[0]).getByText(/Charlie|Alpha|Bravo/);
    expect(firstNameUnsorted).toHaveTextContent("Charlie");

    // Click "Name" header → ascending.
    fireEvent.click(screen.getByText("Name"));
    expect(within(dataRows()[0]).getByText("Alpha")).toBeInTheDocument();

    // Click again → descending.
    fireEvent.click(screen.getByText("Name"));
    expect(within(dataRows()[0]).getByText("Charlie")).toBeInTheDocument();
  });

  it("applies the initial sort from defaultSortKey/defaultSortDirection", () => {
    const data: Row[] = [
      { id: 1, name: "Charlie", amount: 30 },
      { id: 2, name: "Alpha", amount: 10 },
      { id: 3, name: "Bravo", amount: 20 },
    ];

    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={data}
        renderRow={renderRow}
        defaultSortKey="amount"
        defaultSortDirection="desc"
      />,
    );

    // Highest amount (30 → Charlie) first when sorted desc.
    expect(within(dataRows()[0]).getByText("Charlie")).toBeInTheDocument();
  });

  // ── S29: pagination ─────────────────────────────────────────────────
  it("paginates: shows pageSize rows and navigates next/prev", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={makeRows(25)}
        renderRow={renderRow}
        paginate
        pageSize={20}
        pageLabel="services"
      />,
    );

    // First page: exactly 20 rows.
    expect(dataRows()).toHaveLength(20);
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.queryByText("Item 21")).not.toBeInTheDocument();

    const next = screen.getByTestId("pagination-next");
    const prev = screen.getByTestId("pagination-prev");

    // On the first page, prev is disabled and next is enabled.
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    // Go to page 2 → remaining 5 rows.
    fireEvent.click(next);
    expect(dataRows()).toHaveLength(5);
    expect(screen.getByText("Item 21")).toBeInTheDocument();
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();

    // Now next is disabled (last page) and prev is enabled.
    expect(next).toBeDisabled();
    expect(prev).toBeEnabled();

    // Go back to page 1.
    fireEvent.click(prev);
    expect(dataRows()).toHaveLength(20);
    expect(screen.getByText("Item 1")).toBeInTheDocument();
  });

  it("does not render pagination controls when data fits in one page", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={makeRows(5)}
        renderRow={renderRow}
        paginate
        pageSize={20}
      />,
    );

    expect(screen.queryByTestId("pagination-next")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pagination-prev")).not.toBeInTheDocument();
  });

  // ── Select-all checkbox ─────────────────────────────────────────────
  it("renders the select-all checkbox and reports onChange", () => {
    const onChange = jest.fn();
    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={makeRows(3)}
        renderRow={renderRow}
        selectAll={{ checked: false, indeterminate: false, onChange }}
      />,
    );

    const checkbox = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects checked and indeterminate select-all state", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={makeRows(3)}
        renderRow={renderRow}
        selectAll={{ checked: true, indeterminate: false, onChange }}
      />,
    );

    let checkbox = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(false);

    // Deselecting reports false.
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith(false);

    rerender(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={makeRows(3)}
        renderRow={renderRow}
        selectAll={{ checked: false, indeterminate: true, onChange }}
      />,
    );

    checkbox = screen.getByTestId("select-all-checkbox") as HTMLInputElement;
    expect(checkbox.indeterminate).toBe(true);
  });

  // ── S30: shift+click multi-select ───────────────────────────────────
  it("emits a contiguous range on shift+click after a plain click anchor", () => {
    const onShiftSelect = jest.fn();
    const onAnchorReset = jest.fn();

    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={makeRows(4)}
        renderRow={renderRow}
        onShiftSelect={onShiftSelect}
        onAnchorReset={onAnchorReset}
      />,
    );

    const rows = dataRows();

    // Plain click on row index 1 sets the anchor (no range yet).
    fireEvent.click(rows[1]);
    expect(onAnchorReset).toHaveBeenCalledTimes(1);
    expect(onShiftSelect).not.toHaveBeenCalled();

    // Shift+click on row index 3 → range [1, 3].
    fireEvent.click(rows[3], { shiftKey: true });
    expect(onShiftSelect).toHaveBeenCalledTimes(1);
    expect(onShiftSelect).toHaveBeenCalledWith(1, 3);
  });

  it("normalizes the shift+click range when clicking upward", () => {
    const onShiftSelect = jest.fn();

    render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={makeRows(4)}
        renderRow={renderRow}
        onShiftSelect={onShiftSelect}
      />,
    );

    const rows = dataRows();
    fireEvent.click(rows[2]); // anchor at 2
    fireEvent.click(rows[0], { shiftKey: true }); // up to 0 → [0, 2]

    expect(onShiftSelect).toHaveBeenCalledWith(0, 2);
  });

  // ── onVisibleRowsChange callback ────────────────────────────────────
  it("notifies onVisibleRowsChange with items in display order", () => {
    const onVisibleRowsChange = jest.fn<void, [Row[]]>();
    const data: Row[] = [
      { id: 1, name: "Charlie", amount: 30 },
      { id: 2, name: "Alpha", amount: 10 },
    ];

    render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={data}
        renderRow={renderRow}
        onVisibleRowsChange={onVisibleRowsChange}
        defaultSortKey="name"
        defaultSortDirection="asc"
      />,
    );

    expect(onVisibleRowsChange).toHaveBeenCalled();
    const lastArg = onVisibleRowsChange.mock.calls.at(-1)?.[0] ?? [];
    expect(lastArg.map((r) => r.name)).toEqual(["Alpha", "Charlie"]);
  });

  // ── S31 / S32: export buttons ───────────────────────────────────────
  it("shows export buttons and triggers Excel/PDF export on click", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL, AMOUNT_COL]}
        data={makeRows(2)}
        renderRow={renderRow}
        exportExcel
        exportPdf
        exportFilename="expenses"
      />,
    );

    const excelBtn = screen.getByTestId("export-excel-btn");
    const pdfBtn = screen.getByTestId("export-pdf-btn");

    fireEvent.click(excelBtn);
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    expect(exportToExcel).toHaveBeenCalledWith(expect.anything(), "expenses");

    fireEvent.click(pdfBtn);
    expect(exportToPdf).toHaveBeenCalledTimes(1);
    expect(exportToPdf).toHaveBeenCalledWith(expect.anything(), "expenses");
  });

  it("hides the export bar when there are no rows to export", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={[]}
        renderRow={renderRow}
        exportExcel
        exportPdf
      />,
    );

    expect(screen.queryByTestId("export-excel-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("export-pdf-btn")).not.toBeInTheDocument();
  });

  it("renders headerActions and footerContent", () => {
    render(
      <DataTable<Row>
        columns={[NAME_COL]}
        data={makeRows(2)}
        renderRow={renderRow}
        headerActions={<button data-testid="batch-action">Batch</button>}
        footerContent={
          <tr data-testid="totals-row">
            <td>Total</td>
          </tr>
        }
      />,
    );

    expect(screen.getByTestId("batch-action")).toBeInTheDocument();
    expect(screen.getByTestId("totals-row")).toBeInTheDocument();
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-361 — deleting a supplier that still has products or debt opens
 * "Merge into…" instead of deleting; renaming to a taken name offers the
 * same merge. The merge payload is checked against the core schema's own
 * field names (rule 24). The `useApi` mock is ONE stable object (rule 25).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { mergeProductSupplierSchema } from "@liratek/core";
import CategoriesManager from "../CategoriesManager";

const mockGetImpact = jest.fn();
const mockMerge = jest.fn();
const mockDeleteProductSupplier = jest.fn();
const mockGetProductSuppliersFull = jest.fn();
const mockUpdateProductSupplier = jest.fn();

const mockApi = {
  getCategoriesFull: jest.fn().mockResolvedValue([]),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  getProductSuppliersFull: mockGetProductSuppliersFull,
  createProductSupplier: jest.fn(),
  updateProductSupplier: mockUpdateProductSupplier,
  deleteProductSupplier: mockDeleteProductSupplier,
  getProductSupplierImpact: mockGetImpact,
  mergeProductSupplier: mockMerge,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const SUPPLIERS = [
  { id: 1, name: "recall", sort_order: 0, is_active: 1, product_count: 3 },
  { id: 2, name: "reacall", sort_order: 1, is_active: 1, product_count: 2 },
  { id: 3, name: "nobody", sort_order: 2, is_active: 1, product_count: 0 },
];

const IMPACT_WITH_DEBT = {
  product_count: 2,
  ledger_entry_count: 2,
  balance_usd: 50,
  balance_lbp: 900000,
};
const NO_IMPACT = {
  product_count: 0,
  ledger_entry_count: 0,
  balance_usd: 0,
  balance_lbp: 0,
};

function rowButtons(name: string) {
  const row = screen.getByText(name).closest("tr")!;
  return within(row).getAllByRole("button");
}

describe("CategoriesManager — supplier merge (LIRA-361)", () => {
  beforeEach(() => {
    mockGetProductSuppliersFull.mockReset().mockResolvedValue(SUPPLIERS);
    mockGetImpact.mockReset();
    mockMerge.mockReset().mockResolvedValue({
      success: true,
      data: { moved_products: 2, moved_ledger_entries: 2 },
    });
    mockDeleteProductSupplier.mockReset().mockResolvedValue({ success: true });
    mockUpdateProductSupplier.mockReset().mockResolvedValue({ success: true });
    window.confirm = jest.fn().mockReturnValue(true);
  });

  it("delete of a supplier with debt opens Merge into…, never deletes", async () => {
    mockGetImpact.mockResolvedValue({ success: true, data: IMPACT_WITH_DEBT });
    render(<CategoriesManager />);
    await screen.findByText("reacall");

    const [, deleteButton] = rowButtons("reacall");
    fireEvent.click(deleteButton);

    const dialog = await screen.findByTestId("merge-supplier-dialog");
    expect(mockGetImpact).toHaveBeenCalledWith(2);
    expect(mockDeleteProductSupplier).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId("merge-supplier-debt")).toHaveTextContent(
      "$50",
    );

    fireEvent.change(within(dialog).getByTestId("merge-supplier-target"), {
      target: { value: "1" },
    });
    fireEvent.click(within(dialog).getByTestId("merge-supplier-confirm"));

    await waitFor(() => expect(mockMerge).toHaveBeenCalledTimes(1));
    const payload = mockMerge.mock.calls[0][0];
    // Parsed through the real schema: the field names must be its own.
    expect(mergeProductSupplierSchema.parse(payload)).toEqual(payload);
    expect(payload).toEqual(
      mergeProductSupplierSchema.parse({ sourceId: 2, targetId: 1 }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("merge-supplier-dialog")).toBeNull(),
    );
  });

  it("the source supplier is not offered as its own merge target", async () => {
    mockGetImpact.mockResolvedValue({ success: true, data: IMPACT_WITH_DEBT });
    render(<CategoriesManager />);
    await screen.findByText("reacall");
    fireEvent.click(rowButtons("reacall")[1]);

    const select = await screen.findByTestId("merge-supplier-target");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).not.toContain("reacall");
    expect(options).toContain("recall");
  });

  it("delete of an empty supplier still asks and deletes", async () => {
    mockGetImpact.mockResolvedValue({ success: true, data: NO_IMPACT });
    render(<CategoriesManager />);
    await screen.findByText("nobody");
    fireEvent.click(rowButtons("nobody")[1]);

    await waitFor(() =>
      expect(mockDeleteProductSupplier).toHaveBeenCalledWith(3),
    );
    expect(screen.queryByTestId("merge-supplier-dialog")).toBeNull();
  });

  it("renaming to an existing name offers the merge with that supplier picked", async () => {
    mockGetImpact.mockResolvedValue({ success: true, data: IMPACT_WITH_DEBT });
    render(<CategoriesManager />);
    await screen.findByText("reacall");
    fireEvent.click(rowButtons("reacall")[0]);

    const input = screen.getByDisplayValue("reacall");
    fireEvent.change(input, { target: { value: "Recall" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const select = (await screen.findByTestId(
      "merge-supplier-target",
    )) as HTMLSelectElement;
    expect(select.value).toBe("1");
    expect(mockUpdateProductSupplier).not.toHaveBeenCalled();
  });
});

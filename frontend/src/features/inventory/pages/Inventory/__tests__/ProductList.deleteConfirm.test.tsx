/** @jest-environment jsdom */
/**
 * LIRA-143 owner item #7 — the product-delete confirm must DISCLOSE the
 * registered IN_STOCK IMEIs that the delete cascade will also remove, before
 * the operator confirms. The message COPY is covered exhaustively in
 * `features/inventory/__tests__/productUnitsLogic.test.ts`
 * (`buildUnitDeleteWarning`); this file covers the wiring the copy depends on:
 *
 *   1. the units are read (`productUnits.getForProduct(id, "IN_STOCK")`)
 *      BEFORE the delete call, per product being deleted,
 *   2. the dialog renders the disclosure it got back,
 *   3. a product with no units keeps EXACTLY today's dialog,
 *   4. the batch dialog probes every selected product,
 *   5. the delete itself is unchanged — this informs, it never blocks.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Product } from "@liratek/ui";
import ProductList from "../ProductList";

const mockGetProducts = jest.fn();
const mockGetFilterOptions = jest.fn();
const mockDeleteProduct = jest.fn();
const mockGetForProduct = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

/**
 * ONE stable object, not a fresh literal per `useApi()` call: ProductList's
 * `loadProducts` is a `useCallback` keyed on `api`, and its debounce effect is
 * keyed on that callback — a new api identity per render makes the effect
 * re-arm forever and the list never settles.
 */
const mockApi = {
  getProducts: mockGetProducts,
  getProductFilterOptions: mockGetFilterOptions,
  deleteProduct: mockDeleteProduct,
  createProduct: jest.fn(),
  productUnits: { getForProduct: mockGetForProduct },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// The walk-in IMEI lookup card is a sibling feature of the search box and is
// not under test here; its query would otherwise need its own api stub.
jest.mock("../../../hooks/useProductUnits", () => ({
  ...jest.requireActual("../../../hooks/useProductUnits"),
  useUnitStoryQuery: () => ({ data: [] }),
}));

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    barcode: "P-0001",
    name: "iPhone 15 Pro",
    category: "Phones",
    cost_price: 700,
    retail_price: 999,
    stock_quantity: 3,
    min_stock_level: 1,
    tracks_imei_units: 1,
    warranty_months: 6,
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-01 10:00:00",
    ...overrides,
  } as unknown as Product;
}

/** Render and wait out the list's 300ms search/filter debounce. */
async function renderList(products: Product[]) {
  mockGetProducts.mockResolvedValue(products);
  const view = render(<ProductList />);
  for (const p of products) {
    await screen.findByText(p.name, undefined, { timeout: 3000 });
  }
  return view;
}

function confirmMessage(): string {
  return screen.getByTestId("confirm-modal").textContent ?? "";
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFilterOptions.mockResolvedValue({ categories: [], suppliers: [] });
  mockGetForProduct.mockResolvedValue([]);
  mockDeleteProduct.mockResolvedValue({ success: true });
  localStorage.clear();
});

describe("ProductList delete confirm — IMEI disclosure", () => {
  it("reads the product's IN_STOCK units and lists them in the dialog", async () => {
    await renderList([product({ id: 42, name: "iPhone 15 Pro" })]);
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111" },
      { id: 2, imei: "222222222222222" },
    ]);

    fireEvent.click(screen.getByTestId("inventory-delete-42"));

    // IN_STOCK only — a SOLD unit is history, not something the delete removes
    // from the shelf, and the backend cascade is what actually acts on them.
    await waitFor(() =>
      expect(mockGetForProduct).toHaveBeenCalledWith(42, "IN_STOCK"),
    );
    await waitFor(() =>
      expect(confirmMessage()).toContain(
        "also removes 2 registered in-stock IMEIs",
      ),
    );
    expect(confirmMessage()).toContain("111111111111111");
    expect(confirmMessage()).toContain("222222222222222");
    // The original warning is still there — the disclosure is additive.
    expect(confirmMessage()).toContain("cannot be undone");
    // Nothing was deleted by opening the dialog.
    expect(mockDeleteProduct).not.toHaveBeenCalled();
  });

  it("keeps today's dialog verbatim for a product with no registered units", async () => {
    await renderList([product({ id: 7, name: "Milk 1L" })]);
    mockGetForProduct.mockResolvedValue([]);

    fireEvent.click(screen.getByTestId("inventory-delete-7"));

    await waitFor(() => expect(mockGetForProduct).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
        "Confirm",
      ),
    );
    expect(confirmMessage()).toContain(
      "Are you sure you want to delete this product?",
    );
    expect(confirmMessage()).not.toContain("in-stock IMEI");
  });

  it("still deletes on confirm — the dialog informs, it never blocks", async () => {
    await renderList([product({ id: 42 })]);
    mockGetForProduct.mockResolvedValue([{ id: 1, imei: "111111111111111" }]);

    fireEvent.click(screen.getByTestId("inventory-delete-42"));
    await waitFor(() => expect(confirmMessage()).toContain("111111111111111"));

    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));
    await waitFor(() => expect(mockDeleteProduct).toHaveBeenCalledWith(42));
  });

  it("discloses a FAILED unit read rather than implying there are none", async () => {
    await renderList([product({ id: 42 })]);
    mockGetForProduct.mockRejectedValue(new Error("IPC failed"));

    fireEvent.click(screen.getByTestId("inventory-delete-42"));

    await waitFor(() =>
      expect(confirmMessage()).toContain("could not be checked"),
    );
  });

  it("closing the dialog clears the disclosure so the next one starts clean", async () => {
    await renderList([
      product({ id: 42, name: "iPhone 15 Pro" }),
      product({ id: 7, name: "Milk 1L", tracks_imei_units: 0 }),
    ]);
    mockGetForProduct.mockResolvedValue([{ id: 1, imei: "111111111111111" }]);

    fireEvent.click(screen.getByTestId("inventory-delete-42"));
    await waitFor(() => expect(confirmMessage()).toContain("111111111111111"));
    fireEvent.click(screen.getByTestId("confirm-modal-cancel-btn"));

    mockGetForProduct.mockResolvedValue([]);
    fireEvent.click(screen.getByTestId("inventory-delete-7"));
    await waitFor(() =>
      expect(mockGetForProduct).toHaveBeenLastCalledWith(7, "IN_STOCK"),
    );
    await waitFor(() =>
      expect(confirmMessage()).not.toContain("111111111111111"),
    );
  });

  it("probes EVERY selected product for the batch dialog, flag or not", async () => {
    // `tracks_imei_units` is inherited from the CATEGORY, so a re-categorised
    // product can still hold units — the batch dialog must not skip it.
    await renderList([
      product({ id: 42, name: "iPhone 15 Pro", tracks_imei_units: 1 }),
      product({ id: 7, name: "Milk 1L", tracks_imei_units: 0 }),
    ]);
    mockGetForProduct.mockImplementation(async (id: number) =>
      id === 42
        ? [
            { id: 1, imei: "111111111111111" },
            { id: 2, imei: "222222222222222" },
          ]
        : [{ id: 3, imei: "333333333333333" }],
    );

    // Select both rows, then open the batch delete confirm.
    fireEvent.click(
      screen.getByLabelText("Delete iPhone 15 Pro").closest("tr")!,
    );
    fireEvent.click(screen.getByLabelText("Delete Milk 1L").closest("tr")!);
    fireEvent.click(await screen.findByTestId("inventory-batch-delete"));

    await waitFor(() => expect(mockGetForProduct).toHaveBeenCalledTimes(2));
    expect(mockGetForProduct).toHaveBeenCalledWith(42, "IN_STOCK");
    expect(mockGetForProduct).toHaveBeenCalledWith(7, "IN_STOCK");

    await waitFor(() =>
      expect(confirmMessage()).toContain(
        "also removes 3 registered in-stock IMEIs across 2 products",
      ),
    );
    expect(confirmMessage()).toContain("iPhone 15 Pro (2)");
    expect(confirmMessage()).toContain("Milk 1L (1)");
  });
});

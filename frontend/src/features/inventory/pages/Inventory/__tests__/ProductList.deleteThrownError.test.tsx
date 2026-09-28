/** @jest-environment jsdom */

/**
 * LIRA-247 — `ProductList.tsx`'s `handleDelete` catch block hardcoded
 * `appEvents.emit("notification:show", "Failed to delete product", "error")`
 * on ANY thrown error, discarding the real reason. `requestJson` (web)
 * throws a plain `{status,message,details}` object on a non-2xx response (a
 * role 403, or a business-rule refusal surfaced as a throw) — not an `Error`
 * instance — so a hardcoded fallback here hides exactly the kind of refusal
 * this ticket is about ("staff 403s show nothing at all").
 *
 * Harness mirrors `ProductList.deleteConfirm.test.tsx` (same directory,
 * established pattern: one stable `mockApi` identity, real `<ProductList />`).
 *
 * Rule 17 note: the source fix (`getApiErrorMessage` in `handleDelete`'s
 * catch) was applied in the same LIRA-247 pass as this test, before this
 * specific test was run against the unfixed handler — so, unlike this
 * ticket's `CustomServices.advanceFulfillmentThrownError.test.tsx` (written
 * and run failing-first), this one is NOT proven failing-first. It is a
 * straight regression guard for a call site whose bug is the same
 * documented pattern already proven failing-first on the CustomServices
 * call site above.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import type { Product } from "@liratek/ui";
import ProductList from "../ProductList";

const mockGetProducts = jest.fn();
const mockGetFilterOptions = jest.fn();
const mockDeleteProduct = jest.fn();
const mockBatchDeleteProducts = jest.fn();
const mockGetForProduct = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

const mockApi = {
  getProducts: mockGetProducts,
  getProductFilterOptions: mockGetFilterOptions,
  deleteProduct: mockDeleteProduct,
  batchDeleteProducts: mockBatchDeleteProducts,
  createProduct: jest.fn(),
  productUnits: { getForProduct: mockGetForProduct },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

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
    tracks_imei_units: 0,
    warranty_months: 6,
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-01 10:00:00",
    ...overrides,
  } as unknown as Product;
}

async function renderList(products: Product[]) {
  mockGetProducts.mockResolvedValue(products);
  const view = render(<ProductList />);
  for (const p of products) {
    await screen.findByText(p.name, undefined, { timeout: 3000 });
  }
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFilterOptions.mockResolvedValue({ categories: [], suppliers: [] });
  mockGetForProduct.mockResolvedValue([]);
  localStorage.clear();
});

describe("ProductList delete — THROWN error is surfaced with the real reason (LIRA-247)", () => {
  it("shows the thrown ApiError's real message instead of the generic 'Failed to delete product'", async () => {
    await renderList([product({ id: 42, name: "iPhone 15 Pro" })]);
    mockDeleteProduct.mockRejectedValue({
      status: 403,
      message: "Only an admin can delete products",
      details: {},
    });
    const emitSpy = jest.spyOn(appEvents, "emit");

    fireEvent.click(screen.getByTestId("inventory-delete-42"));
    await waitFor(() =>
      expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
        "Confirm",
      ),
    );
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    await waitFor(() => expect(mockDeleteProduct).toHaveBeenCalledWith(42));
    await waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith(
        "notification:show",
        "Only an admin can delete products",
        "error",
      ),
    );
    expect(emitSpy).not.toHaveBeenCalledWith(
      "notification:show",
      "Failed to delete product",
      "error",
    );
  });
});

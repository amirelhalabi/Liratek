/** @jest-environment jsdom */
/**
 * LIRA-225 — the edit form's Adjust Stock hand-off (`handleAdjustFromForm`)
 * used to resolve the row via `products.find(...)`, ProductList's own
 * CURRENT (filtered/searched) list state — not the whole catalogue. A
 * product hidden by the active filters, or simply stale relative to the
 * server (e.g. right after a "Save & adjust" persisted an edit — LIRA-224),
 * either dead-ended with a false "no longer in the list" message or handed
 * AdjustStockModal a stale row.
 *
 * The fix: fetch the single row by id (`api.getProductById`, wired
 * dual-mode via `useApi()`/`backendApi.ts`/`ElectronApiAdapter.ts`/
 * `ApiAdapter`) instead of scanning `products`. This file proves the modal
 * receives whatever `getProductById` returns, NOT the (possibly stale)
 * `products` array entry — the array below is deliberately never refreshed,
 * so a pre-fix `products.find` would still report the OLD quantity.
 *
 * Process note (rule 17): as with LIRA-224/228 in this same batch, the fix
 * was written before this guard ran against pre-fix code — disclosed rather
 * than temporarily re-breaking the finished `handleAdjustFromForm` to fake a
 * red run. Both cases below pass against the current (already-fixed) code.
 * NOT proven failing-first (LIRA-223).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { appEvents } from "@liratek/ui";
import type { Product } from "@liratek/ui";
import ProductList from "../ProductList";

const mockGetProducts = jest.fn();
const mockGetFilterOptions = jest.fn();
const mockGetProductById = jest.fn();
const mockDeleteProduct = jest.fn();
const mockBatchDeleteProducts = jest.fn();
const mockGetForProduct = jest.fn();
const mockUpdateProduct = jest.fn();
const mockCreateProduct = jest.fn();
const mockGetCategories = jest.fn();
const mockGetCategoriesFull = jest.fn();
const mockGetProductSuppliers = jest.fn();
const mockGetAllSettings = jest.fn();
const mockGetProductByBarcode = jest.fn();
const mockGetStockAdjustments = jest.fn();
const mockGetOpenStockBatches = jest.fn();
const mockAdjustStock = jest.fn();
const mockReceiveStock = jest.fn();
const mockRegisterProductUnits = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

/** ONE stable object — see ProductList.deleteConfirm.test.tsx's matching
 *  comment: a fresh literal per `useApi()` call would re-arm the debounced
 *  load effect forever (rule 25). */
const mockApi = {
  getProducts: mockGetProducts,
  getProductFilterOptions: mockGetFilterOptions,
  getProductById: mockGetProductById,
  deleteProduct: mockDeleteProduct,
  batchDeleteProducts: mockBatchDeleteProducts,
  updateProduct: mockUpdateProduct,
  createProduct: mockCreateProduct,
  getCategories: mockGetCategories,
  getCategoriesFull: mockGetCategoriesFull,
  getProductSuppliers: mockGetProductSuppliers,
  getAllSettings: mockGetAllSettings,
  getProductByBarcode: mockGetProductByBarcode,
  getStockAdjustments: mockGetStockAdjustments,
  getOpenStockBatches: mockGetOpenStockBatches,
  adjustStock: mockAdjustStock,
  receiveStock: mockReceiveStock,
  productUnits: {
    getForProduct: mockGetForProduct,
    register: mockRegisterProductUnits,
  },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// The walk-in IMEI lookup card is a sibling feature, not under test here.
jest.mock("../../../hooks/useProductUnits", () => ({
  ...jest.requireActual("../../../hooks/useProductUnits"),
  useUnitStoryQuery: () => ({ data: [] }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 5,
    barcode: "B-0005",
    name: "Widget",
    category: "Accessories",
    cost_price: 2,
    retail_price: 5,
    stock_quantity: 5,
    min_stock_level: 1,
    supplier: "Acme Supply",
    tracks_imei_units: 0,
    warranty_months: null,
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-01 10:00:00",
    ...overrides,
  } as unknown as Product;
}

async function renderList(products: Product[]) {
  mockGetProducts.mockResolvedValue(products);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ProductList />
    </QueryClientProvider>,
  );
  for (const p of products) {
    await screen.findByText(p.name, undefined, { timeout: 3000 });
  }
  return view;
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFilterOptions.mockResolvedValue({ categories: [], suppliers: [] });
  mockGetForProduct.mockResolvedValue([]);
  mockGetCategories.mockResolvedValue(["Accessories"]);
  mockGetCategoriesFull.mockResolvedValue([
    { name: "Accessories", tracks_imei_units: 0 },
  ]);
  mockGetProductSuppliers.mockResolvedValue(["Acme Supply"]);
  mockGetAllSettings.mockResolvedValue([]);
  mockGetStockAdjustments.mockResolvedValue([]);
  mockGetOpenStockBatches.mockResolvedValue([]);
  localStorage.clear();
});

describe("ProductList — Adjust Stock hand-off from the edit form fetches the FRESH row (LIRA-225)", () => {
  it("opens AdjustStockModal with getProductById's row, not the (stale) products array entry", async () => {
    // Deliberately never re-resolved after this — `products` stays at
    // stock_quantity=5 for the life of the test, proving the modal's "99"
    // came from `getProductById`, not from `ProductList`'s own list state.
    await renderList([product({ id: 5, name: "Widget", stock_quantity: 5 })]);
    mockGetProductById.mockResolvedValue(
      product({ id: 5, name: "Widget", stock_quantity: 99 }),
    );

    fireEvent.click(screen.getByTestId("inventory-edit-5"));
    await screen.findByTestId("product-form-adjust-stock");

    fireEvent.click(screen.getByTestId("product-form-adjust-stock"));

    await waitFor(() => expect(mockGetProductById).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.getByText("99 units")).toBeInTheDocument());
    // The old dead-end message never fires on a successful fetch.
    expect(
      screen.queryByText(/no longer in the list/i),
    ).not.toBeInTheDocument();
  });

  it("a failed/missing single-row read falls back to the old notice + reload, instead of throwing", async () => {
    await renderList([product({ id: 5, name: "Widget" })]);
    mockGetProductById.mockResolvedValue(null);
    const emitSpy = jest.spyOn(appEvents, "emit");

    fireEvent.click(screen.getByTestId("inventory-edit-5"));
    await screen.findByTestId("product-form-adjust-stock");
    mockGetProducts.mockClear();

    fireEvent.click(screen.getByTestId("product-form-adjust-stock"));

    await waitFor(() => expect(mockGetProductById).toHaveBeenCalledWith(5));
    await waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith(
        "notification:show",
        "This product is no longer in the list — refreshing.",
        "error",
      ),
    );
    // The fallback reload actually re-fires getProducts.
    await waitFor(() => expect(mockGetProducts).toHaveBeenCalled());
    await flushMicrotasks();
  });
});

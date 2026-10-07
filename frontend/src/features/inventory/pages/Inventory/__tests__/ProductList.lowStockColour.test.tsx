/** @jest-environment jsdom */

/**
 * Owner decision 2026-10-07 — a minimum stock of 0 means "no minimum", so
 * the Inventory list never paints that product's stock red. Same rule as
 * the server's `LOW_STOCK_PREDICATE_SQL` (TopBar notification + Dashboard
 * count): without it, every product turns red right after a Reset Data,
 * which sets both stock and minimum stock to 0.
 *
 * Harness mirrors `ProductList.deleteThrownError.test.tsx` (one stable
 * `mockApi` identity, real `<ProductList />`).
 */
import { render, screen } from "@testing-library/react";
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

describe("ProductList stock colour — low-stock rule", () => {
  it("does not paint stock red when the product has no minimum (0), but still does below a real minimum", async () => {
    await renderList([
      product({
        id: 1,
        name: "No minimum",
        stock_quantity: 0,
        min_stock_level: 0,
      }),
      product({
        id: 2,
        name: "Below minimum",
        stock_quantity: 2,
        min_stock_level: 5,
      }),
      product({
        id: 3,
        name: "Above minimum",
        stock_quantity: 10,
        min_stock_level: 5,
      }),
    ]);

    expect(screen.getByText("0 units")).not.toHaveClass("text-red-400");
    expect(screen.getByText("2 units")).toHaveClass("text-red-400");
    expect(screen.getByText("10 units")).not.toHaveClass("text-red-400");
  });
});

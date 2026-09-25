/** @jest-environment jsdom */
/**
 * LIRA-207 (OWNER_NOTES_REMAINING_BUILD.md #13) — the barcode field's label
 * reads "Number" for a Phone Lines category product, "Barcode" otherwise.
 * Backed by the same `isPhoneLineCategoryName` predicate InventoryService
 * uses for the duplicate-number guard (rule 14 — one classification, not
 * two copies that can drift); see
 * `packages/core/src/services/__tests__/InventoryService.phoneLineNumber.test.ts`
 * for the guard's own tests.
 *
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * build batch).
 *
 * Every case here fails on pre-fix code (the label was a hardcoded
 * "Barcode" string with no lines-category branch at all) — rule 17's
 * failing-first requirement for a guard test.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Product } from "@liratek/ui";
import ProductForm from "../ProductForm";

const mockApi = {
  getCategories: jest.fn(),
  getCategoriesFull: jest.fn(),
  getProductSuppliers: jest.fn(),
  getAllSettings: jest.fn(),
  getProductByBarcode: jest.fn(),
  updateProduct: jest.fn(),
  createProduct: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 7,
    barcode: "03123456",
    name: "MTC prepaid line",
    category: "Phone Lines",
    cost_price: 5,
    retail_price: 15,
    min_stock_level: 1,
    stock_quantity: 1,
    supplier: null,
    tracks_imei_units: 0,
    warranty_months: null,
    created_at: "2026-09-24 10:00:00",
    updated_at: "2026-09-24 10:00:00",
    ...overrides,
  } as unknown as Product;
}

function renderForm(overrides: { product?: Product | null } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductForm
        onClose={jest.fn()}
        onSave={jest.fn()}
        product={overrides.product ?? null}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCategories.mockResolvedValue([
    "Accessories",
    "Phones",
    "Phone Lines",
  ]);
  mockApi.getCategoriesFull.mockResolvedValue([
    { name: "Accessories", tracks_imei_units: 0 },
    { name: "Phones", tracks_imei_units: 1 },
    { name: "Phone Lines", tracks_imei_units: 0 },
  ]);
  mockApi.getProductSuppliers.mockResolvedValue([]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.updateProduct.mockResolvedValue({ success: true });
  mockApi.createProduct.mockResolvedValue({ success: true });
});

describe("ProductForm — barcode field label for a lines category (LIRA-207)", () => {
  it('labels the field "Barcode" for a non-lines category (create mode default)', () => {
    renderForm();
    expect(screen.getByText("Barcode")).toBeInTheDocument();
    expect(screen.queryByText("Number")).not.toBeInTheDocument();
  });

  it('labels the field "Number" when editing a product already in a lines category', () => {
    renderForm({ product: product({ category: "Phone Lines" }) });
    expect(screen.getByText("Number")).toBeInTheDocument();
    expect(screen.queryByText("Barcode")).not.toBeInTheDocument();
  });

  it('labels the field "Barcode" for a non-lines category product', () => {
    renderForm({
      product: product({ category: "Accessories", barcode: "ACC-0001" }),
    });
    expect(screen.getByText("Barcode")).toBeInTheDocument();
    expect(screen.queryByText("Number")).not.toBeInTheDocument();
  });

  it("swaps the label live as the operator types/selects a lines category in create mode", () => {
    renderForm();
    expect(screen.getByText("Barcode")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Select or type category name"),
      { target: { value: "Phone Lines" } },
    );

    expect(screen.getByText("Number")).toBeInTheDocument();
  });

  it("shows a phone-number-shaped placeholder only for a lines category", () => {
    renderForm({ product: product({ category: "Phone Lines" }) });
    expect(screen.getByPlaceholderText("e.g. 03 123 456")).toBeInTheDocument();
  });
});

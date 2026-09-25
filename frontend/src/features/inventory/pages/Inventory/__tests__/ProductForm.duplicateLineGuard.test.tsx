/** @jest-environment jsdom */
/**
 * LIRA-207 (OWNER_NOTES_REMAINING_BUILD.md #13), fix-round N13-2 — the
 * "Duplicate Barcode" one-click resubmit must never be offered for a
 * phone-lines category collision: clicking it sets the field to a
 * DUP-suffixed suggestion and resubmits successfully, listing the SAME
 * physical number twice, which is exactly what the owner said must never
 * happen.
 *
 * `InventoryService.phoneLineNumber.test.ts` proves the SERVICE no longer
 * returns `suggested_barcode` for a lines-category collision. This file is
 * the independent FRONTEND backstop (defense in depth, rule 14's spirit —
 * never rely on one layer alone for a "must never duplicate" invariant): it
 * mocks a hypothetical/stale API response that DOES carry a
 * `suggested_barcode` even for a lines category, and asserts the button is
 * still not rendered — so a future regression in either layer alone cannot
 * reopen the duplicate-listing hole.
 *
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * build batch).
 *
 * Fails on pre-fix code (rule 17): before this fix the button had no
 * `categoryIsLines` gate at all, so the lines-category case below would
 * find the "Duplicate Barcode" button present.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

function renderForm(p: Product) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductForm onClose={jest.fn()} onSave={jest.fn()} product={p} />
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
});

describe("ProductForm — Duplicate Barcode resubmit button is gated by lines category (N13-2)", () => {
  it("does NOT render the resubmit button for a lines-category collision, even if the API returned a suggestion", () => {
    // Hypothetical/stale API response — the real (fixed) service never
    // sends `suggested_barcode` for a lines category, but the frontend
    // must not depend on that alone.
    mockApi.updateProduct.mockResolvedValue({
      success: false,
      code: "DUPLICATE_BARCODE",
      error: "This number is already listed",
      suggested_barcode: "03123456DUP1",
    });

    renderForm(product({ category: "Phone Lines" }));
    fireEvent.click(screen.getByText("Save Product"));

    return waitFor(() => {
      expect(screen.getByText("Duplicate Barcode Detected")).toBeInTheDocument();
    }).then(() => {
      expect(screen.queryByText("Duplicate Barcode")).not.toBeInTheDocument();
    });
  });

  it("still renders the resubmit button for a non-lines category collision", () => {
    mockApi.updateProduct.mockResolvedValue({
      success: false,
      code: "DUPLICATE_BARCODE",
      error: "Barcode already exists",
      suggested_barcode: "ACC-0001DUP1",
    });

    renderForm(
      product({ category: "Accessories", barcode: "ACC-0001" }),
    );
    fireEvent.click(screen.getByText("Save Product"));

    return waitFor(() => {
      expect(screen.getByText("Duplicate Barcode Detected")).toBeInTheDocument();
    }).then(() => {
      expect(screen.getByText("Duplicate Barcode")).toBeInTheDocument();
    });
  });
});

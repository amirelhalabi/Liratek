/**
 * ProductForm — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type Product } from "@liratek/ui";
import ProductForm from "../ProductForm";

const mockApi = {
  getCategories: jest.fn(),
  getCategoriesFull: jest.fn(),
  getProductSuppliers: jest.fn(),
  getAllSettings: jest.fn(),
  getProductByBarcode: jest.fn(),
  updateProduct: jest.fn(),
  createProduct: jest.fn(),
  // LIRA-309 — a lines-category product loads its line details on open.
  getResaleLines: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockApi.getCategories as unknown as jest.Mock).mockReset();
  (mockApi.getCategoriesFull as unknown as jest.Mock).mockReset();
  (mockApi.getProductSuppliers as unknown as jest.Mock).mockReset();
  (mockApi.getAllSettings as unknown as jest.Mock).mockReset();
  (mockApi.getProductByBarcode as unknown as jest.Mock).mockReset();
  (mockApi.updateProduct as unknown as jest.Mock).mockReset();
  (mockApi.createProduct as unknown as jest.Mock).mockReset();
  (mockApi.getResaleLines as unknown as jest.Mock).mockReset();
  (mockApi.getResaleLines as unknown as jest.Mock).mockResolvedValue([]);
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("ProductForm.duplicateLineGuard (LIRA-207)", () => {
  beforeAll(resetBetweenFiles);

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
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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
        expect(
          screen.getByText("Duplicate Barcode Detected"),
        ).toBeInTheDocument();
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

      renderForm(product({ category: "Accessories", barcode: "ACC-0001" }));
      fireEvent.click(screen.getByText("Save Product"));

      return waitFor(() => {
        expect(
          screen.getByText("Duplicate Barcode Detected"),
        ).toBeInTheDocument();
      }).then(() => {
        expect(screen.getByText("Duplicate Barcode")).toBeInTheDocument();
      });
    });
  });
});

describe("ProductForm.numberLabel (LIRA-207)", () => {
  beforeAll(resetBetweenFiles);

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
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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
      expect(
        screen.getByPlaceholderText("e.g. 03 123 456"),
      ).toBeInTheDocument();
    });
  });
});

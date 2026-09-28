/** @jest-environment jsdom */
/**
 * LIRA-228 — the product form loses a warranty (months) edit on
 * minimize/restore.
 *
 * `warrantyMonths` is free-standing state in ProductForm (not part of
 * `formData`), so the minimize snapshot must carry it as a sibling key and a
 * restore must be able to seed it back — otherwise a restore always falls
 * through to `product.warranty_months`, silently discarding an in-progress
 * warranty-only edit made before minimizing.
 *
 * Process note (rule 17): as with LIRA-224 in this same batch, the fix
 * (`initialWarrantyMonths` prop + the `onMinimize` snapshot carrying
 * `warrantyMonths`) was written before this guard ran against pre-fix code.
 * NOT proven failing-first — disclosed per rule 17 rather than temporarily
 * re-breaking the finished code to fake a red run. Both cases below pass
 * against the current (already-fixed) code.
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
    barcode: "P-0007",
    name: "USB-C Cable",
    category: "Accessories",
    cost_price: 2,
    retail_price: 5,
    min_stock_level: 5,
    stock_quantity: 40,
    supplier: "Acme Supply",
    tracks_imei_units: 0,
    warranty_months: 6,
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-01 10:00:00",
    ...overrides,
  } as unknown as Product;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCategories.mockResolvedValue(["Accessories"]);
  mockApi.getCategoriesFull.mockResolvedValue([
    { name: "Accessories", tracks_imei_units: 0 },
  ]);
  mockApi.getProductSuppliers.mockResolvedValue(["Acme Supply"]);
  mockApi.getAllSettings.mockResolvedValue([]);
});

function warrantyInput() {
  return screen.getByLabelText("Warranty (months)") as HTMLInputElement;
}

describe("ProductForm — warranty (months) survives minimize/restore (LIRA-228)", () => {
  it("onMinimize's snapshot carries the CURRENT (edited) warrantyMonths, not the product's stored one", () => {
    const onMinimize = jest.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ProductForm
          onClose={jest.fn()}
          onSave={jest.fn()}
          product={product({ warranty_months: 6 })}
          onMinimize={onMinimize}
        />
      </QueryClientProvider>,
    );

    expect(warrantyInput().value).toBe("6");
    fireEvent.change(warrantyInput(), { target: { value: "18" } });

    fireEvent.click(screen.getByTitle("Minimize"));

    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onMinimize.mock.calls[0][0].warrantyMonths).toBe("18");
  });

  it("a restored form (initialWarrantyMonths set) shows the edited value, not product.warranty_months", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const prod = product({ warranty_months: 6 });
    const initialFormData = {
      barcode: prod.barcode,
      name: prod.name,
      category: prod.category,
      cost_price: prod.cost_price,
      retail_price: prod.retail_price,
      min_stock_level: prod.min_stock_level,
      stock_quantity: prod.stock_quantity,
      supplier: prod.supplier ?? "",
    };

    render(
      <QueryClientProvider client={queryClient}>
        <ProductForm
          onClose={jest.fn()}
          onSave={jest.fn()}
          product={prod}
          initialFormData={initialFormData}
          initialWarrantyMonths="18"
        />
      </QueryClientProvider>,
    );

    // The bug: before this fix there was no `initialWarrantyMonths` prop, so
    // a restore always re-seeded from `product.warranty_months` ("6") here,
    // silently discarding the "18" edit that was on screen when minimized.
    expect(warrantyInput().value).toBe("18");
  });

  it("a fresh Edit open (no initialWarrantyMonths) still seeds from product.warranty_months as before", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ProductForm
          onClose={jest.fn()}
          onSave={jest.fn()}
          product={product({ warranty_months: 6 })}
        />
      </QueryClientProvider>,
    );

    expect(warrantyInput().value).toBe("6");
  });
});

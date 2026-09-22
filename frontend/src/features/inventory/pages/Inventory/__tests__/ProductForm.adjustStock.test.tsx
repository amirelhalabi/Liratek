/** @jest-environment jsdom */
/**
 * LIRA-208 — "Adjust Stock" is discoverable from the edit form.
 *
 * D13 (SUPPLIER_STOCK_INTAKE_PLAN.md) keeps the Quantity field
 * `disabled={!!product}` on purpose: `InventoryService.updateProduct`
 * silently ignores `stock_quantity` on an edit, so an editable field would be
 * a silent no-op. These tests do NOT touch that — they cover the new
 * discoverability affordance that sits beside the disabled field and hands
 * off to the product list's existing `AdjustStockModal` (via `onAdjustStock`)
 * instead of re-implementing the adjust flow here.
 *
 * Every case that asserts the button's PRESENCE or its click behavior fails
 * on pre-fix code (the button does not exist yet) — rule 17's failing-first
 * requirement for a guard test. The two cases asserting its ABSENCE (edit
 * mode with no `onAdjustStock`; create mode with no `product`) don't need
 * that proof — a button that never existed would trivially pass either one
 * for the wrong reason. They instead pin the render gate
 * (`product && onAdjustStock`) down as two independent conditions, each
 * tested with the OTHER one satisfied, so neither can pass by accident.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Product } from "@liratek/ui";
import ProductForm from "../ProductForm";

/**
 * ONE stable module-level object, not a fresh literal per `useApi()` call
 * (rule 25): `ProductForm` has three `useEffect(..., [api])` whose fallback
 * paths call `setCategoriesFull([])` / `setCategories([...])` /
 * `setSupplierNames([])` with fresh array literals every render. An unstable
 * `useApi` mock (`useApi: () => ({ … })`, a new object each call) would churn
 * `api`'s identity forever and trip a synchronous render loop that surfaces
 * as "Jest worker ran out of memory", not as a timeout.
 */
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
    warranty_months: null,
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-01 10:00:00",
    ...overrides,
  } as unknown as Product;
}

function renderForm(
  overrides: {
    product?: Product | null;
    onAdjustStock?: () => void;
    onClose?: () => void;
    onSave?: () => void;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = overrides.onClose ?? jest.fn();
  const onSave = overrides.onSave ?? jest.fn();

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ProductForm
        onClose={onClose}
        onSave={onSave}
        product={overrides.product ?? null}
        {...(overrides.onAdjustStock
          ? { onAdjustStock: overrides.onAdjustStock }
          : {})}
      />
    </QueryClientProvider>,
  );

  return { ...utils, onClose, onSave };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCategories.mockResolvedValue(["Accessories", "Phones"]);
  mockApi.getCategoriesFull.mockResolvedValue([
    { name: "Accessories", tracks_imei_units: 0 },
    { name: "Phones", tracks_imei_units: 1 },
  ]);
  mockApi.getProductSuppliers.mockResolvedValue(["Acme Supply"]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.updateProduct.mockResolvedValue({ success: true });
  mockApi.createProduct.mockResolvedValue({ success: true });
});

describe("ProductForm — Adjust Stock discoverability (LIRA-208)", () => {
  it("shows a focusable Adjust Stock button in edit mode, with Quantity still disabled", () => {
    const onAdjustStock = jest.fn();
    renderForm({ product: product(), onAdjustStock });

    const button = screen.getByTestId("product-form-adjust-stock");
    expect(button).toBeEnabled();
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
  });

  it("edit mode without onAdjustStock: no Adjust Stock button, Quantity stays disabled", () => {
    // `product` given, `onAdjustStock` withheld — isolates "no handler" as
    // the reason the button is absent, independent of create-vs-edit mode.
    renderForm({ product: product() });

    expect(
      screen.queryByTestId("product-form-adjust-stock"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toBeDisabled();
  });

  it("create mode: no Adjust Stock button, and Quantity is enabled", () => {
    // No `product` prop at all — the POS create-only render shape.
    // `onAdjustStock` IS supplied (though POS never would) — isolates
    // "no product" as the reason the button is absent, independent of
    // whether a handler was passed.
    const onAdjustStock = jest.fn();
    renderForm({ onAdjustStock });

    expect(
      screen.queryByTestId("product-form-adjust-stock"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toBeEnabled();
  });

  it("a pristine edit form hands off to Adjust Stock on one click", () => {
    const onAdjustStock = jest.fn();
    renderForm({ product: product(), onAdjustStock });

    fireEvent.click(screen.getByTestId("product-form-adjust-stock"));

    expect(onAdjustStock).toHaveBeenCalledTimes(1);
    // No confirmation strip when nothing was edited.
    expect(
      screen.queryByText(/unsaved changes/i),
    ).not.toBeInTheDocument();
  });

  it("a dirty edit form confirms before discarding, then hands off", () => {
    const onAdjustStock = jest.fn();
    renderForm({ product: product(), onAdjustStock });

    fireEvent.change(screen.getByLabelText("Retail Price ($)"), {
      target: { value: "9.99" },
    });

    // First click: dirty, so it must NOT hand off yet.
    fireEvent.click(screen.getByTestId("product-form-adjust-stock"));
    expect(onAdjustStock).not.toHaveBeenCalled();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();

    // "Keep editing" dismisses the strip without handing off.
    fireEvent.click(screen.getByText("Keep editing"));
    expect(onAdjustStock).not.toHaveBeenCalled();
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();

    // Re-open the strip and this time discard.
    fireEvent.click(screen.getByTestId("product-form-adjust-stock"));
    fireEvent.click(screen.getByText("Discard & adjust"));
    expect(onAdjustStock).toHaveBeenCalledTimes(1);
  });

  it("the Adjust Stock button is type=button and never submits the form", () => {
    const onAdjustStock = jest.fn();
    renderForm({ product: product(), onAdjustStock });

    fireEvent.click(screen.getByTestId("product-form-adjust-stock"));

    expect(onAdjustStock).toHaveBeenCalledTimes(1);
    expect(mockApi.updateProduct).not.toHaveBeenCalled();
  });
});

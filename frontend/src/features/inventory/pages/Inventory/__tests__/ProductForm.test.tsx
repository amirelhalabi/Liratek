/**
 * ProductForm — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockApi.getCategories as unknown as jest.Mock).mockReset();
  (mockApi.getCategoriesFull as unknown as jest.Mock).mockReset();
  (mockApi.getProductSuppliers as unknown as jest.Mock).mockReset();
  (mockApi.getAllSettings as unknown as jest.Mock).mockReset();
  (mockApi.getProductByBarcode as unknown as jest.Mock).mockReset();
  (mockApi.updateProduct as unknown as jest.Mock).mockReset();
  (mockApi.createProduct as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("ProductForm.adjustStock (LIRA-208)", () => {
  beforeAll(resetBetweenFiles);

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
   *
   * LIRA-223: the failing-first proof described above was never actually
   * executed (this batch's process forbade running tests mid-batch) — the
   * presence/click cases below are labelled "(not proven failing-first)"
   * accordingly. Under the reworded rule 17 (owner decision 2026-09-26), the
   * fix is that label, not a retroactive revert/run/revert.
   */

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
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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
    it("shows a focusable Adjust Stock button in edit mode, with Quantity still disabled (not proven failing-first — LIRA-223)", () => {
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

    it("a pristine edit form hands off to Adjust Stock on one click (not proven failing-first — LIRA-223)", () => {
      const onAdjustStock = jest.fn();
      renderForm({ product: product(), onAdjustStock });

      fireEvent.click(screen.getByTestId("product-form-adjust-stock"));

      expect(onAdjustStock).toHaveBeenCalledTimes(1);
      // No confirmation strip when nothing was edited.
      expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
    });

    it("a dirty edit form confirms before discarding, then hands off (not proven failing-first — LIRA-223)", () => {
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

    it("the Adjust Stock button is type=button and never submits the form (not proven failing-first — LIRA-223)", () => {
      const onAdjustStock = jest.fn();
      renderForm({ product: product(), onAdjustStock });

      fireEvent.click(screen.getByTestId("product-form-adjust-stock"));

      expect(onAdjustStock).toHaveBeenCalledTimes(1);
      expect(mockApi.updateProduct).not.toHaveBeenCalled();
    });
  });
});

describe("ProductForm.saveAndAdjust (LIRA-224)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-224 — "Save & adjust": a primary action on the unsaved-changes
   * confirm strip that appears when the operator clicks Adjust Stock with
   * unsaved edits still in the form. Saves through the normal path
   * (`api.updateProduct`) and only on success hands off to Adjust Stock
   * (`onAdjustStock`); a failed save shows the error and stays on the form.
   *
   * Process note (rule 17): for this ticket the implementation was written in
   * the same pass as this file, before this guard was run against pre-fix
   * code — unlike LIRA-222 and the error-message fix in this same batch, which
   * were proven red-then-green. This is NOT proven failing-first. Per rule
   * 17's own guidance, that is disclosed here rather than temporarily
   * re-breaking the finished `handleSaveAndAdjust`/button code to fake a red
   * run. All cases below pass against the current (already-fixed) code.
   */

  // Setup notes from this file (its mocks are the shared ones above):
  /**
   * ONE stable module-level object (rule 25) — see
   * ProductForm.adjustStock.test.tsx's matching comment for why a fresh
   * literal per `useApi()` call would trip a synchronous render loop.
   */

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

  function renderForm(onAdjustStock: () => void) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onClose = jest.fn();
    const onSave = jest.fn();

    const utils = render(
      <QueryClientProvider client={queryClient}>
        <ProductForm
          onClose={onClose}
          onSave={onSave}
          product={product()}
          onAdjustStock={onAdjustStock}
        />
      </QueryClientProvider>,
    );

    return { ...utils, onClose, onSave };
  }

  /** Dirty the form and open the confirm strip, as a real operator would. */
  function makeDirtyAndOpenStrip() {
    fireEvent.change(screen.getByLabelText("Retail Price ($)"), {
      target: { value: "9.99" },
    });
    fireEvent.click(screen.getByTestId("product-form-adjust-stock"));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCategories.mockResolvedValue(["Accessories", "Phones"]);
    mockApi.getCategoriesFull.mockResolvedValue([
      { name: "Accessories", tracks_imei_units: 0 },
    ]);
    mockApi.getProductSuppliers.mockResolvedValue(["Acme Supply"]);
    mockApi.getAllSettings.mockResolvedValue([]);
    mockApi.updateProduct.mockResolvedValue({ success: true });
    mockApi.createProduct.mockResolvedValue({ success: true });
  });

  describe("ProductForm — Save & adjust (LIRA-224)", () => {
    it("shows Save & adjust as the first (primary) action in the unsaved-changes strip", () => {
      const onAdjustStock = jest.fn();
      renderForm(onAdjustStock);
      makeDirtyAndOpenStrip();

      const strip = screen.getByText(/unsaved changes/i).closest("div")!;
      const buttons = strip.querySelectorAll("button");
      expect(buttons[0]).toHaveAttribute(
        "data-testid",
        "product-form-save-and-adjust",
      );
      expect(buttons[0]).toHaveTextContent("Save & adjust");
    });

    it("on success: saves through the normal path, then hands off to Adjust Stock and calls onSave", async () => {
      const onAdjustStock = jest.fn();
      const { onSave } = renderForm(onAdjustStock);
      makeDirtyAndOpenStrip();

      fireEvent.click(screen.getByTestId("product-form-save-and-adjust"));

      await waitFor(() =>
        expect(mockApi.updateProduct).toHaveBeenCalledTimes(1),
      );
      const [id, payload] = mockApi.updateProduct.mock.calls[0];
      expect(id).toBe(7);
      expect(payload).toMatchObject({ id: 7, retail_price: 9.99 });

      await waitFor(() => expect(onAdjustStock).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledTimes(1);
      // The confirm strip is gone — Save & adjust actually completed the
      // hand-off rather than leaving the form in a half-confirmed state.
      expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
    });

    it("on failure: shows the server's error, stays on the form, and never hands off", async () => {
      mockApi.updateProduct.mockResolvedValue({
        success: false,
        error: "Selling price must be greater than cost price",
      });
      const onAdjustStock = jest.fn();
      const { onSave } = renderForm(onAdjustStock);
      makeDirtyAndOpenStrip();

      fireEvent.click(screen.getByTestId("product-form-save-and-adjust"));

      await waitFor(() =>
        expect(
          screen.getByText("Selling price must be greater than cost price"),
        ).toBeInTheDocument(),
      );
      expect(onAdjustStock).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      // Still on the form — the product's own fields are still there to fix.
      expect(screen.getByLabelText("Retail Price ($)")).toBeInTheDocument();
    });
  });
});

describe("ProductForm.warrantyMinimizeRestore (LIRA-228)", () => {
  beforeAll(resetBetweenFiles);

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
});

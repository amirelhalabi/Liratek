/** @jest-environment jsdom */
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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Product } from "@liratek/ui";
import ProductForm from "../ProductForm";

/**
 * ONE stable module-level object (rule 25) — see
 * ProductForm.adjustStock.test.tsx's matching comment for why a fresh
 * literal per `useApi()` call would trip a synchronous render loop.
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

function renderForm(onAdjustStock: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

    await waitFor(() => expect(mockApi.updateProduct).toHaveBeenCalledTimes(1));
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

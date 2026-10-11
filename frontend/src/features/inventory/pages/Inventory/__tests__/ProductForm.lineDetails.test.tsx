/** @jest-environment jsdom */
/**
 * LIRA-309 (T024) — a product in a lines category shows Carrier / Line
 * expiry date / Line credit, loads an existing line's details, and saves them
 * through `saveResaleLine` (field names from the schema, rule 24) once the
 * product itself is saved.
 *
 * NOT proven failing-first (rule 17): the form change was written before
 * this file.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { saveResaleLineSchema } from "@liratek/core";
import { appEvents, type Product } from "@liratek/ui";
import ProductForm from "../ProductForm";

const mockApi = {
  getCategories: jest.fn(),
  getCategoriesFull: jest.fn(),
  getProductSuppliers: jest.fn(),
  getAllSettings: jest.fn(),
  getProductByBarcode: jest.fn(),
  updateProduct: jest.fn(),
  createProduct: jest.fn(),
  getResaleLines: jest.fn(),
  saveResaleLine: jest.fn(),
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
    barcode: "03555101",
    name: "MTC line 03 555 101",
    category: "Phone Lines",
    cost_price: 15,
    retail_price: 25,
    min_stock_level: 0,
    stock_quantity: 1,
    supplier: null,
    tracks_imei_units: 0,
    warranty_months: null,
    created_at: "2026-10-11 10:00:00",
    updated_at: "2026-10-11 10:00:00",
    ...overrides,
  } as unknown as Product;
}

function renderForm(p: Product | null) {
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
  mockApi.getCategories.mockResolvedValue(["Accessories", "Phone Lines"]);
  mockApi.getCategoriesFull.mockResolvedValue([
    { name: "Accessories", tracks_imei_units: 0 },
    { name: "Phone Lines", tracks_imei_units: 0 },
  ]);
  mockApi.getProductSuppliers.mockResolvedValue([]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.updateProduct.mockResolvedValue({ success: true });
  mockApi.createProduct.mockResolvedValue({ success: true, id: 42 });
  mockApi.getResaleLines.mockResolvedValue([]);
  mockApi.saveResaleLine.mockResolvedValue({ success: true });
});

describe("ProductForm — line details for a lines category (LIRA-309)", () => {
  it("shows no line fields for a non-lines product", () => {
    renderForm(product({ category: "Accessories", barcode: "ACC-1" }));
    expect(screen.queryByLabelText("Carrier")).not.toBeInTheDocument();
  });

  it("loads an existing line's carrier, expiry and credit", async () => {
    mockApi.getResaleLines.mockResolvedValue([
      {
        product_id: 7,
        carrier: "alfa",
        validity_expires_at: "2026-10-20",
        credits: 2.5,
      },
    ]);
    renderForm(product());
    await waitFor(() =>
      expect((screen.getByLabelText("Carrier") as HTMLSelectElement).value).toBe(
        "alfa",
      ),
    );
    expect((screen.getByLabelText("Line expiry date") as HTMLInputElement).value).toBe(
      "2026-10-20",
    );
    expect((screen.getByLabelText("Line credit ($)") as HTMLInputElement).value).toBe(
      "2.5",
    );
  });

  it("saves the details after updating the product, with the schema's field names", async () => {
    renderForm(product());
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "mtc" } });
    fireEvent.change(screen.getByLabelText("Line expiry date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Line credit ($)"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Product/ }));

    await waitFor(() => expect(mockApi.saveResaleLine).toHaveBeenCalledTimes(1));
    expect(mockApi.updateProduct).toHaveBeenCalled();
    const sent = mockApi.saveResaleLine.mock.calls[0][0];
    expect(sent).toEqual(
      saveResaleLineSchema.parse({
        product_id: 7,
        carrier: "mtc",
        validity_expires_at: "2026-12-01",
        credits: 3,
      }),
    );
  });

  it("refuses to save an expiry without a carrier, before saving anything", async () => {
    renderForm(product());
    fireEvent.change(screen.getByLabelText("Line expiry date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Product/ }));
    expect(
      await screen.findByText("Choose the line's carrier (MTC or Alfa)."),
    ).toBeInTheDocument();
    expect(mockApi.updateProduct).not.toHaveBeenCalled();
    expect(mockApi.saveResaleLine).not.toHaveBeenCalled();
  });

  it("warns instead of silently dropping the details when a new product comes back without an id", async () => {
    mockApi.createProduct.mockResolvedValue({ success: true });
    const emit = jest.spyOn(appEvents, "emit");
    renderForm(null);
    fireEvent.change(screen.getByLabelText(/^Category/), {
      target: { value: "Phone Lines" },
    });
    fireEvent.change(await screen.findByLabelText("Carrier"), {
      target: { value: "mtc" },
    });
    fireEvent.change(screen.getByLabelText(/Product Name/), {
      target: { value: "MTC line" },
    });
    fireEvent.change(screen.getByLabelText("Cost Price ($)"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("Retail Price ($)"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Product/ }));
    await waitFor(() => expect(mockApi.createProduct).toHaveBeenCalled());
    await waitFor(() =>
      expect(emit).toHaveBeenCalledWith(
        "notification:show",
        expect.stringContaining("line details were not"),
        "warning",
      ),
    );
    expect(mockApi.saveResaleLine).not.toHaveBeenCalled();
    emit.mockRestore();
  });

  it("leaves details alone when none are entered (editing an older line's name)", async () => {
    renderForm(product());
    fireEvent.click(screen.getByRole("button", { name: /Save Product/ }));
    await waitFor(() => expect(mockApi.updateProduct).toHaveBeenCalled());
    expect(mockApi.saveResaleLine).not.toHaveBeenCalled();
  });
});

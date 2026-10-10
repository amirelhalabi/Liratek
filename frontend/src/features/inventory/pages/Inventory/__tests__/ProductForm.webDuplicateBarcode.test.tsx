/** @jest-environment jsdom */
/**
 * Web app: adding a product whose barcode already exists must show the
 * "Duplicate Barcode Detected" box with the suggested barcode — the same
 * thing desktop has always shown.
 *
 * The form's `createProduct` here is the REAL web adapter
 * (`backendApi.createProduct`, REST branch — no `window.api`), fed the
 * response `POST /api/inventory/products` now sends for a duplicate:
 * HTTP 200 + the service's own envelope (rule 19c). The server side of the
 * fix is proven by backend/src/api/__tests__/inventoryProductCreateEnvelope.api.test.ts.
 *
 * Rule 17 disclosure: this file is NOT proven failing-first. The fix was in
 * the backend route (it used to answer 409, which `requestJson` throws on),
 * and this test mocks the HTTP response, so it cannot observe that route.
 * It guards the frontend half of the contract: that the adapter and the
 * form carry `code` / `suggested_barcode` through to the screen on web.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProductForm from "../ProductForm";

const realBackendApi =
  jest.requireActual<typeof import("@/api/backendApi")>("@/api/backendApi");

/** ONE stable module-level object (rule 25). */
const mockApi = {
  getCategories: jest.fn(),
  getCategoriesFull: jest.fn(),
  getProductSuppliers: jest.fn(),
  getAllSettings: jest.fn(),
  getProductByBarcode: jest.fn(),
  updateProduct: jest.fn(),
  createProduct: jest.fn(
    (payload: Parameters<typeof realBackendApi.createProduct>[0]) =>
      realBackendApi.createProduct(payload),
  ),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function jsonResponse(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function renderCreateForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductForm onClose={jest.fn()} onSave={jest.fn()} />
    </QueryClientProvider>,
  );
}

function fillAndSubmit(barcode: string) {
  fireEvent.change(screen.getByLabelText("Product Name"), {
    target: { value: "USB cable" },
  });
  fireEvent.change(screen.getByLabelText("Barcode"), {
    target: { value: barcode },
  });
  fireEvent.change(screen.getByLabelText("Category"), {
    target: { value: "Accessories" },
  });
  fireEvent.change(screen.getByLabelText("Cost Price ($)"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Retail Price ($)"), {
    target: { value: "5" },
  });
  fireEvent.click(screen.getByText("Save Product"));
}

beforeEach(() => {
  jest.clearAllMocks();
  delete (window as unknown as { api?: unknown }).api;
  mockApi.getCategories.mockResolvedValue(["Accessories"]);
  mockApi.getCategoriesFull.mockResolvedValue([
    { name: "Accessories", tracks_imei_units: 0 },
  ]);
  mockApi.getProductSuppliers.mockResolvedValue([]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.getProductByBarcode.mockResolvedValue(null);
});

describe("ProductForm on the web app — duplicate barcode", () => {
  it("shows the duplicate box with the suggested barcode, and the button fills it in", async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, {
        success: false,
        error: "Barcode already exists",
        code: "DUPLICATE_BARCODE",
        suggested_barcode: "ACC-0001DUP1",
      }),
    ) as unknown as typeof fetch;

    renderCreateForm();
    fillAndSubmit("ACC-0001");

    await waitFor(() =>
      expect(
        screen.getByText("Duplicate Barcode Detected"),
      ).toBeInTheDocument(),
    );
    // It went through the REST branch, not IPC.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/inventory/products"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(screen.getByText("ACC-0001DUP1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Duplicate Barcode"));
    expect(screen.getByLabelText("Barcode")).toHaveValue("ACC-0001DUP1");
  });
});

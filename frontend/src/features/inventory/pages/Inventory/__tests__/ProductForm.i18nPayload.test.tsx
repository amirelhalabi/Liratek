/** @jest-environment jsdom */
/**
 * LIRA-331 — the product save payloads must not depend on the display
 * language. Drives the real form (create, update, and a phone-line product
 * that also saves its line details) once in English and once in Arabic and
 * asserts every captured payload is deep-equal. Selectors are element ids, so
 * the same steps work in both languages.
 *
 * Written before ProductForm was converted to i18n: it passed against the
 * unconverted form (not failing-first — a guard against future drift, e.g. a
 * translated default category or label leaking into the payload).
 */
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Product } from "@liratek/ui";
import { i18n, loadLanguage } from "@/i18n/setup";
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
    barcode: "ACC-0007",
    name: "USB-C cable",
    category: "Accessories",
    cost_price: 2,
    retail_price: 5,
    min_stock_level: 3,
    stock_quantity: 10,
    supplier: "Acme",
    tracks_imei_units: 0,
    warranty_months: null,
    created_at: "2026-10-11 10:00:00",
    updated_at: "2026-10-11 10:00:00",
    ...overrides,
  } as unknown as Product;
}

type Scenario = "create" | "update" | "phoneLine";

interface Captured {
  create: unknown[];
  update: unknown[];
  line: unknown[];
}

function byId<T extends HTMLElement>(container: HTMLElement, id: string): T {
  const el = container.querySelector(`#${id}`);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

async function runScenario(scenario: Scenario): Promise<Captured> {
  jest.clearAllMocks();
  mockApi.getCategories.mockResolvedValue(["Accessories", "Phone Lines"]);
  mockApi.getCategoriesFull.mockResolvedValue([
    { name: "Accessories", tracks_imei_units: 0 },
    { name: "Phone Lines", tracks_imei_units: 0 },
  ]);
  mockApi.getProductSuppliers.mockResolvedValue(["Acme"]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.updateProduct.mockResolvedValue({ success: true });
  mockApi.createProduct.mockResolvedValue({ success: true, id: 42 });
  mockApi.getResaleLines.mockResolvedValue([]);
  mockApi.saveResaleLine.mockResolvedValue({ success: true });

  const onSave = jest.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const p =
    scenario === "update"
      ? product()
      : scenario === "phoneLine"
        ? product({
            barcode: "03555101",
            name: "MTC line 03 555 101",
            category: "Phone Lines",
            supplier: null,
          })
        : null;
  const { container, unmount } = render(
    <QueryClientProvider client={queryClient}>
      <ProductForm onClose={jest.fn()} onSave={onSave} product={p} />
    </QueryClientProvider>,
  );

  if (scenario === "create") {
    fireEvent.change(byId(container, "product-name"), {
      target: { value: "Phone case" },
    });
    fireEvent.change(byId(container, "product-barcode"), {
      target: { value: "CASE-1" },
    });
    fireEvent.change(byId(container, "product-cost-price"), {
      target: { value: "4" },
    });
    fireEvent.change(byId(container, "product-retail-price"), {
      target: { value: "9.5" },
    });
    fireEvent.change(byId(container, "product-stock"), {
      target: { value: "12" },
    });
    fireEvent.change(byId(container, "product-min-stock"), {
      target: { value: "2" },
    });
    fireEvent.change(byId(container, "product-warranty-months"), {
      target: { value: "6" },
    });
  } else if (scenario === "update") {
    fireEvent.change(byId(container, "product-name"), {
      target: { value: "USB-C cable 2m" },
    });
    fireEvent.change(byId(container, "product-warranty-months"), {
      target: { value: "3" },
    });
  } else {
    fireEvent.change(byId(container, "product-line-carrier"), {
      target: { value: "mtc" },
    });
    fireEvent.change(byId(container, "product-line-expiry"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(byId(container, "product-line-credits"), {
      target: { value: "3.5" },
    });
  }

  const form = container.querySelector("form");
  if (!form) throw new Error("form not found");
  fireEvent.submit(form);
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  if (scenario === "phoneLine") {
    await waitFor(() => expect(mockApi.saveResaleLine).toHaveBeenCalled());
  }

  const captured: Captured = {
    create: mockApi.createProduct.mock.calls.map((c) => c[0]),
    update: mockApi.updateProduct.mock.calls.map((c) => c.slice(0, 2)),
    line: mockApi.saveResaleLine.mock.calls.map((c) => c[0]),
  };
  unmount();
  return captured;
}

async function inLanguage(lang: "en" | "ar", scenario: Scenario) {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runScenario(scenario);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ProductForm — save payloads are identical in English and Arabic", () => {
  it.each<Scenario>(["create", "update", "phoneLine"])("%s", async (scenario) => {
    const en = await inLanguage("en", scenario);
    const ar = await inLanguage("ar", scenario);
    expect(ar).toEqual(en);
    const calls = en.create.length + en.update.length;
    expect(calls).toBe(1);
    if (scenario === "create") {
      // The stored default category stays the English data value.
      expect(en.create[0]).toEqual(
        expect.objectContaining({
          category: "Accessories",
          stock_quantity: 12,
          min_stock_level: 2,
          warranty_months: 6,
        }),
      );
    }
    if (scenario === "phoneLine") expect(en.line).toHaveLength(1);
  });
});

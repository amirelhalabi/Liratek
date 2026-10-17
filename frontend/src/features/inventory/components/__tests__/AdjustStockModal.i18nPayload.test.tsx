/** @jest-environment jsdom */
/**
 * LIRA-331 — the stock-adjustment payload must not depend on the display
 * language. Drives the real modal through each save branch (a decrease via
 * adjustStock, a delivery via receiveStock, a delivery attached to a recorded
 * supplier debt) once in English and once in Arabic, and asserts the captured
 * payloads are deep-equal. Selectors are data-testids, so the same steps work
 * in both languages.
 *
 * Written before AdjustStockModal was converted to i18n: it passed against the
 * unconverted component (not failing-first — a guard against future drift,
 * e.g. a translated label leaking into `reason`).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { i18n, loadLanguage } from "@/i18n/setup";
import AdjustStockModal from "../AdjustStockModal";

const mockAdjustStock = jest.fn();
const mockReceiveStock = jest.fn();
const mockGetStockAdjustments = jest.fn();
const mockGetOpenStockBatches = jest.fn();
const mockGetSuppliers = jest.fn();
const mockGetOpenRecordedSupplierDebts = jest.fn();

// Module-level: one stable identity (rule 25).
const mockApi = {
  adjustStock: mockAdjustStock,
  receiveStock: mockReceiveStock,
  getStockAdjustments: mockGetStockAdjustments,
  getOpenStockBatches: mockGetOpenStockBatches,
  getSuppliers: mockGetSuppliers,
  getOpenRecordedSupplierDebts: mockGetOpenRecordedSupplierDebts,
  productUnits: { register: jest.fn() },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

type Scenario = "decrease" | "delivery" | "attachDebt";

async function runScenario(scenario: Scenario): Promise<unknown> {
  jest.clearAllMocks();
  mockGetStockAdjustments.mockResolvedValue([]);
  mockGetOpenStockBatches.mockResolvedValue([]);
  mockGetSuppliers.mockResolvedValue([{ id: 7, name: "Acme Distributors" }]);
  mockGetOpenRecordedSupplierDebts.mockResolvedValue(
    scenario === "attachDebt"
      ? [{ id: 99, amount_usd: 50, amount_lbp: 1500000, note: "incoming" }]
      : [],
  );
  mockAdjustStock.mockResolvedValue({ success: true });
  mockReceiveStock.mockResolvedValue({ success: true, batch_id: 1 });

  const onSuccess = jest.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <AdjustStockModal
        product={{
          id: 42,
          name: "Test Widget",
          barcode: "1234567890",
          stock_quantity: 10,
          cost_price: 2,
          supplier: "Acme Distributors",
        }}
        onClose={jest.fn()}
        onSuccess={onSuccess}
      />
    </QueryClientProvider>,
  );

  if (scenario === "decrease") {
    fireEvent.click(screen.getByTestId("adjust-mode-delta"));
    fireEvent.change(screen.getByTestId("adjust-quantity"), {
      target: { value: "-3" },
    });
  } else {
    fireEvent.change(screen.getByTestId("adjust-quantity"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByTestId("adjust-unit-cost"), {
      target: { value: "2.5" },
    });
    if (scenario === "delivery") {
      fireEvent.click(screen.getByTestId("adjust-old-stock"));
    } else {
      const select = await screen.findByTestId("adjust-recorded-debt");
      fireEvent.change(select, { target: { value: "99" } });
    }
  }
  fireEvent.change(screen.getByTestId("adjust-reason"), {
    target: { value: "Recount after delivery" },
  });
  fireEvent.click(screen.getByTestId("adjust-submit"));

  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  const mock = scenario === "decrease" ? mockAdjustStock : mockReceiveStock;
  expect(mock).toHaveBeenCalledTimes(1);
  const payload = mock.mock.calls[0][0];
  unmount();
  return payload;
}

async function inLanguage(lang: "en" | "ar", scenario: Scenario) {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runScenario(scenario);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("AdjustStockModal — payload is identical in English and Arabic", () => {
  it.each<Scenario>(["decrease", "delivery", "attachDebt"])(
    "%s",
    async (scenario) => {
      const en = await inLanguage("en", scenario);
      const ar = await inLanguage("ar", scenario);
      expect(ar).toEqual(en);
      // Sanity: the reason is the operator's text, never a catalog string.
      expect((en as { reason: string }).reason).toBe("Recount after delivery");
    },
  );
});

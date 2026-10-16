/** @jest-environment jsdom */

/**
 * Shop-day finding B3 (2026-10-16), owner decision Q4: on Services, text
 * typed into the "Search Item or Service" box only became the description
 * when the cashier pressed Enter. Typing "Charging port replacement - Galaxy
 * A52" and pressing Submit sent `description: ""` (saved as plain "Custom
 * Service"). The typed text must be the description — in the ONE payload
 * (rule 22) — and the box must be empty again after submitting so it cannot
 * leak into the next service.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomServices from "../index";

// ── Mock useApi ──
const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();
// Shared/overridable so individual tests can seed a specific partner list
// (e.g. LIRA-118's exactly-one-partner scenario) — a fresh jest.fn() per
// useApi() call would not be reachable from a test's mockResolvedValueOnce.
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
const mockGetProducts = jest.fn().mockResolvedValue([]);

// Module-level, stable identity (rule 25).
const mockApi = {
  addCustomService: mockAddCustomService,
  deleteCustomService: mockDeleteCustomService,
  getClients: mockGetClients,
  getProducts: mockGetProducts,
  getRates: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  partners: { getAll: mockPartnersGetAll },
  servicePresets: {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
  },
};

jest.mock("@liratek/ui", () => ({
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
  useApi: () => mockApi,
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
  PageHeader: ({
    title,
    subtitle,
    actions,
  }: {
    title: string;
    subtitle?: string;
    icon?: unknown;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {actions}
    </div>
  ),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select
      data-testid="paid-by-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DataTable: ({
    columns,
    data,
    emptyMessage,
  }: {
    columns: unknown[];
    data: unknown[];
    emptyMessage?: string;
  }) => (
    <div data-testid="data-table">
      {data && (data as unknown[]).length === 0 ? (
        <div>{emptyMessage}</div>
      ) : (
        <table>
          <thead>
            <tr>
              {(columns as unknown[]).map((_, i) => (
                <th key={i}>Column {i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data as unknown[]).map((_, i) => (
              <tr key={i}>
                <td>Row {i}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ),
  MultiPaymentInput: ({
    totalAmount,
    onChange,
    totals,
    currency,
    totalAmountCurrency,
    onExchangeRateChange,
  }: {
    totalAmount?: number;
    onChange?: (payments: unknown[]) => void;
    totals?: { amount: number; currency: string }[];
    currency?: string;
    totalAmountCurrency?: string;
    onExchangeRateChange?: (rate: number) => void;
  }) => (
    <div data-testid="multi-payment-input">
      {/* Exposes the currency contract the page feeds the payment section —
          the LBP-toggle guard asserts on this. */}
      <div data-testid="multi-payment-props">
        {JSON.stringify({ totals, currency, totalAmountCurrency })}
      </div>
      <select
        data-testid="paid-by-select"
        onChange={(e) =>
          onChange?.([
            {
              method: e.target.value,
              amount: totalAmount ?? 0,
              currencyCode: "USD",
            },
          ])
        }
      >
        <option value="CASH">Cash</option>
        <option value="CARD">Card</option>
        <option value="CUSTOMER_ACCOUNT">Customer Account</option>
      </select>
      {/* Simulates the operator editing the payment sheet's own "1 USD = X
          LBP" rate field — the real MultiPaymentInput fires
          onExchangeRateChange on every edit (and once on mount). */}
      <button
        type="button"
        data-testid="stub-edit-rate"
        onClick={() => onExchangeRateChange?.(91000)}
      >
        Edit Rate
      </button>
    </div>
  ),
  // The REAL SearchBar: the shared stub in CustomServices.test.tsx commits
  // free text on every keystroke, which is exactly what hid this bug.
  SearchBar: jest.requireActual("@liratek/ui").SearchBar,
}));

// ── Mock usePaymentMethods ──
jest.mock("../../../../../hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "CARD", label: "Card" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    ],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash" },
      { code: "CARD", label: "Card" },
    ],
  }),
}));

// ── Mock useSession ──
const mockLinkTransaction = jest.fn();
const mockAddToCart = jest.fn();
jest.mock("../../../../sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: mockLinkTransaction,
    addToCart: mockAddToCart,
  }),
}));

// ── Mock useSessionAutoFill ──
jest.mock("../../../../sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: () => ({
    customerName: "",
    customerPhone: "",
  }),
}));

// ── Mock HistoryModal ──
jest.mock("../components/HistoryModal", () => ({
  HistoryModal: () => <div data-testid="history-modal" />,
}));

// ── Mock StatsCards ──
jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => (
    <div data-testid="stats-cards">
      <span>{"Today's Services"}</span>
      <span>{"Today's Revenue"}</span>
      <span>{"Today's Profit"}</span>
    </div>
  ),
}));

// ── Mock getExchangeRates ──
jest.mock("@/utils/exchangeRates", () => ({
  getExchangeRates: () => ({ buyRate: 89500, sellRate: 89500 }),
}));

// ── Mock useCustomServices hook ──
const mockReload = jest.fn();
jest.mock("../../../hooks/useCustomServices", () => ({
  useCustomServices: () => ({
    history: [],
    loading: false,
    error: null,
    reload: mockReload,
    summary: {
      count: 0,
      totalCostUsd: 0,
      totalCostLbp: 0,
      totalPriceUsd: 0,
      totalPriceLbp: 0,
      totalProfitUsd: 0,
      totalProfitLbp: 0,
    },
  }),
}));

// ── Mock logger ──
jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Mock useSaveAsClient ──
jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

// ── Mock SaveAsClientCheckbox ──
jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

describe("CustomServices — typed search text is the description", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddCustomService.mockResolvedValue({ success: true, id: 42 });
    mockGetClients.mockResolvedValue([]);
    mockGetProducts.mockResolvedValue([]);
  });

  it("sends the typed (not Enter-committed) text as the description, then clears the box", async () => {
    render(<CustomServices />);

    const search = screen.getByTestId("custom-service-item-search");
    fireEvent.change(search, {
      target: { value: "Charging port replacement - Galaxy A52" },
    });

    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "8" } }); // cost USD
    fireEvent.change(usdInputs[1], { target: { value: "25" } }); // price USD

    fireEvent.click(screen.getByText("Submit Service"));

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledTimes(1);
    });
    expect(mockAddCustomService.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        description: "Charging port replacement - Galaxy A52",
        cost_usd: 8,
        price_usd: 25,
      }),
    );

    // The next service starts blank — the old text must not carry over.
    await waitFor(() => {
      expect(
        (screen.getByTestId("custom-service-item-search") as HTMLInputElement)
          .value,
      ).toBe("");
    });
  });

  it("still sends an empty description when nothing was typed", async () => {
    render(<CustomServices />);

    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "5" } });
    fireEvent.change(usdInputs[1], { target: { value: "10" } });
    fireEvent.click(screen.getByText("Submit Service"));

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledWith(
        expect.objectContaining({ description: "" }),
      );
    });
  });

  it("a cleared box sends no stale text", async () => {
    render(<CustomServices />);

    const search = screen.getByTestId("custom-service-item-search");
    fireEvent.change(search, { target: { value: "Old text" } });
    fireEvent.click(screen.getByLabelText("Clear search"));

    const usdInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(usdInputs[0], { target: { value: "5" } });
    fireEvent.change(usdInputs[1], { target: { value: "10" } });
    fireEvent.click(screen.getByText("Submit Service"));

    await waitFor(() => {
      expect(mockAddCustomService).toHaveBeenCalledWith(
        expect.objectContaining({ description: "" }),
      );
    });
  });
});

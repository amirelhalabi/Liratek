/** @jest-environment jsdom */

/**
 * LIRA-260 — Custom Services: picking a preset prefills its saved price;
 * editing the price away from it shows the shared amber PriceChangeWarning
 * (preset vs new price); restoring it hides the warning. Warning only — the
 * submit button stays usable. Free-text services have no saved price.
 *
 * Rule 17: written before the wiring and seen failing. Harness copied from
 * CustomServices.test.tsx, with a STABLE useApi mock (rule 25).
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

const mockApi = {
  addCustomService: mockAddCustomService,
  deleteCustomService: mockDeleteCustomService,
  getClients: mockGetClients,
  getRates: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  partners: { getAll: mockPartnersGetAll },
  servicePresets: {
    list: jest.fn().mockResolvedValue({
      success: true,
      data: [
        {
          id: 7,
          name: "Screen Fix",
          category: "repair",
          cost_usd: 10,
          cost_lbp: 0,
          price_usd: 25,
          price_lbp: 0,
        },
      ],
    }),
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
  SearchBar: ({
    onFreeText,
  }: {
    onSearch?: unknown;
    onFreeText?: (v: string) => void;
    placeholder?: string;
    [key: string]: unknown;
  }) => (
    <input
      data-testid="search-bar"
      placeholder="e.g., Phone screen repair, SIM activation"
      onChange={(e) => onFreeText?.(e.target.value)}
    />
  ),
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


function priceInput(): HTMLInputElement {
  return document.getElementById("svc-price") as HTMLInputElement;
}

async function pickPreset() {
  render(<CustomServices />);
  fireEvent.click(await screen.findByText("Screen Fix"));
  await waitFor(() => expect(priceInput()).toHaveValue("25"));
}

describe("CustomServices — price-change warning (LIRA-260)", () => {
  beforeEach(() => {
    mockAddCustomService.mockResolvedValue({ success: true, id: 42 });
    mockGetClients.mockResolvedValue([]);
  });

  it("edit a preset price -> warning with preset vs new; restore -> gone", async () => {
    await pickPreset();
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();

    fireEvent.change(priceInput(), { target: { value: "20" } });
    expect(await screen.findByTestId("price-change-warning")).toHaveTextContent(
      "Price changed: catalog $25.00 → $20.00",
    );
    expect(screen.getByText("Submit Service").closest("button")).not.toBeDisabled();

    fireEvent.change(priceInput(), { target: { value: "25" } });
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();
  });

  it("switching currency drops the comparison (no stale $ baseline vs LBP)", async () => {
    await pickPreset();
    fireEvent.change(priceInput(), { target: { value: "20" } });
    await screen.findByTestId("price-change-warning");
    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();
    // Back to USD: the field was cleared by the toggle — an empty field is
    // not "$0", so no false "catalog $25.00 → $0.00".
    fireEvent.click(screen.getByRole("button", { name: "USD" }));
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();
    // Typing a real price still compares against the preset.
    fireEvent.change(priceInput(), { target: { value: "20" } });
    expect(await screen.findByTestId("price-change-warning")).toHaveTextContent(
      "catalog $25.00 → $20.00",
    );
  });

  it("a free-text service has no saved price, so never warns", async () => {
    render(<CustomServices />);
    fireEvent.change(screen.getByTestId("search-bar"), {
      target: { value: "Custom job" },
    });
    fireEvent.change(priceInput(), { target: { value: "20" } });
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();
  });
});

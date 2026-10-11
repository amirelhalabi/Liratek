/** @jest-environment jsdom */

/**
 * LIRA-310 US5 — Custom Services: the payment sheet's discount is REAL.
 * Before: MultiPaymentInput showed a discount field that lowered what the
 * customer paid, but the page never booked it — the server was sent the
 * full price and refused the short payment. Now the page passes
 * `onDiscountChange` + `maxDiscount = max(0, price − cost)` (active
 * currency) and sends `price − discount` as the price, built once for both
 * the direct submit and the session basket (rule 22). The built-in Waive
 * then works, since it adds the gap to that discount.
 *
 * Rule 17: written before the wiring; red run recorded in the task report.
 * Harness copied from CustomServices.priceChangeWarning.test.tsx, with a
 * STABLE useApi mock (rule 25).
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
    totals,
    maxDiscount,
    onDiscountChange,
  }: {
    totals?: { amount: number; currency: string }[];
    maxDiscount?: number;
    onDiscountChange?: (discount: number) => void;
  }) => (
    <div data-testid="multi-payment-input">
      <div data-testid="mpi-props">
        {JSON.stringify({ totals, maxDiscount: maxDiscount ?? null })}
      </div>
      {/* The real MPI reports its discount (typed, or added by the built-in
          Waive) through onDiscountChange, normalized to the total's
          currency. */}
      <button type="button" data-testid="stub-discount-2" onClick={() => onDiscountChange?.(2)}>
        d2
      </button>
      <button type="button" data-testid="stub-discount-15" onClick={() => onDiscountChange?.(15)}>
        d15
      </button>
      <button type="button" data-testid="stub-discount-50000" onClick={() => onDiscountChange?.(50_000)}>
        d50000
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



function fillUsd(cost: string, price: string) {
  const usdInputs = screen.getAllByPlaceholderText("0.00");
  fireEvent.change(usdInputs[0], { target: { value: cost } });
  fireEvent.change(usdInputs[1], { target: { value: price } });
}

function mpiProps(): { totals: { amount: number; currency: string }[]; maxDiscount: number | null } {
  return JSON.parse(screen.getByTestId("mpi-props").textContent ?? "{}");
}

describe("LIRA-310 — Custom Services discount is saved", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddCustomService.mockResolvedValue({ success: true, id: 42 });
    mockGetClients.mockResolvedValue([]);
  });

  it("caps the discount at price − cost in the active currency", () => {
    render(<CustomServices />);
    fillUsd("20", "30");
    expect(mpiProps().maxDiscount).toBe(10);
  });

  it("price $30, discount $2 → the payload's price is $28", async () => {
    render(<CustomServices />);
    fillUsd("20", "30");
    fireEvent.click(screen.getByTestId("stub-discount-2"));
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    expect(mockAddCustomService.mock.calls[0][0]).toEqual(
      expect.objectContaining({ price_usd: 28, price_lbp: 0, cost_usd: 20 }),
    );
  });

  it("a discount above price − cost is capped there (never sells below cost)", async () => {
    render(<CustomServices />);
    fillUsd("20", "30");
    fireEvent.click(screen.getByTestId("stub-discount-15"));
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    expect(mockAddCustomService.mock.calls[0][0]).toEqual(
      expect.objectContaining({ price_usd: 20 }),
    );
  });

  it("LBP: 900,000 price, 50,000 discount → price_lbp 850,000", async () => {
    render(<CustomServices />);
    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    const lbpInputs = screen.getAllByPlaceholderText("0");
    fireEvent.change(lbpInputs[1], { target: { value: "900000" } });
    expect(mpiProps().maxDiscount).toBe(900_000);
    fireEvent.click(screen.getByTestId("stub-discount-50000"));
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    expect(mockAddCustomService.mock.calls[0][0]).toEqual(
      expect.objectContaining({ price_lbp: 850_000, price_usd: 0 }),
    );
  });

  it("no discount → the full price is sent (unchanged)", async () => {
    render(<CustomServices />);
    fillUsd("20", "30");
    fireEvent.click(screen.getByText("Submit Service"));
    await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
    expect(mockAddCustomService.mock.calls[0][0]).toEqual(
      expect.objectContaining({ price_usd: 30 }),
    );
  });
});

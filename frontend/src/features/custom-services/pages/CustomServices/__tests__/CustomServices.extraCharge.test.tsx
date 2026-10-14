/** @jest-environment jsdom */

/**
 * LIRA-319 T048 (Custom Services) — the payment sheet's "+ Extra" side.
 *
 * The page turns on MultiPaymentInput's extra mode (`onExtraChange`,
 * `maxExtra` = the selling price) and sends the extra as its own
 * `extra_usd` / `extra_lbp` — the price stays the selling price, never
 * price + extra. A discount is sent as `discount_usd` / `discount_lbp` so
 * the server can refuse both together. No extra on a partner service, a
 * payout, or a session basket line (the basket takes it at checkout).
 *
 * Every asserted payload is parsed through `createCustomServiceSchema`
 * (rule 24), so the field names are the schema's own. Harness copied from
 * CustomServices.lira310Discount.test.tsx (stable useApi mock, rule 25).
 * Not proven failing-first: written after the page wiring.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CustomServices from "../index";
import { createCustomServiceSchema } from "@liratek/core";

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
    maxExtra,
    onDiscountChange,
    onExtraChange,
  }: {
    totals?: { amount: number; currency: string }[];
    maxExtra?: number;
    onDiscountChange?: (discount: number) => void;
    onExtraChange?: (extra: number) => void;
  }) => (
    <div data-testid="multi-payment-input">
      <div data-testid="mpi-props">
        {JSON.stringify({
          totals,
          extraMode: !!onExtraChange,
          maxExtra: maxExtra ?? null,
        })}
      </div>
      {/* The real MPI reports the extra (in extra mode) through
          onExtraChange, normalized to the total's currency, and its
          discount as 0 meanwhile — one or the other. */}
      <button type="button" data-testid="stub-extra-1" onClick={() => onExtraChange?.(1)}>
        e1
      </button>
      <button type="button" data-testid="stub-extra-100000" onClick={() => onExtraChange?.(100_000)}>
        e100000
      </button>
      <button type="button" data-testid="stub-discount-2" onClick={() => onDiscountChange?.(2)}>
        d2
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
let mockActiveSession: { id: number } | null = null;
jest.mock("../../../../sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
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

function mpiProps(): {
  totals: { amount: number; currency: string }[];
  extraMode: boolean;
  maxExtra: number | null;
} {
  return JSON.parse(screen.getByTestId("mpi-props").textContent ?? "{}");
}

/** The submitted payload, parsed through the core schema (rule 24). */
async function submitted() {
  fireEvent.click(screen.getByText("Submit Service"));
  await waitFor(() => expect(mockAddCustomService).toHaveBeenCalled());
  return createCustomServiceSchema.parse(mockAddCustomService.mock.calls[0][0]);
}

describe("LIRA-319 — Custom Services extra charge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveSession = null;
    mockAddCustomService.mockResolvedValue({ success: true, id: 42 });
    mockGetClients.mockResolvedValue([]);
  });

  it("offers extra mode, capped at the selling price; the total stays the price", () => {
    render(<CustomServices />);
    fillUsd("7", "9");
    expect(mpiProps()).toEqual({
      totals: [{ amount: 9, currency: "USD" }],
      extraMode: true,
      maxExtra: 9,
    });
  });

  it("price $9 + extra $1 → extra_usd 1, price and cost unchanged", async () => {
    render(<CustomServices />);
    fillUsd("7", "9");
    fireEvent.click(screen.getByTestId("stub-extra-1"));
    const p = await submitted();
    expect(p).toEqual(
      expect.objectContaining({ price_usd: 9, cost_usd: 7, extra_usd: 1 }),
    );
    expect(p).not.toHaveProperty("extra_lbp");
    expect(p).not.toHaveProperty("discount_usd");
  });

  it("LBP: 900,000 + extra 100,000 → extra_lbp 100,000, price_lbp unchanged", async () => {
    render(<CustomServices />);
    fireEvent.click(screen.getByRole("button", { name: "LBP" }));
    const lbpInputs = screen.getAllByPlaceholderText("0");
    fireEvent.change(lbpInputs[1], { target: { value: "900000" } });
    fireEvent.click(screen.getByTestId("stub-extra-100000"));
    const p = await submitted();
    expect(p).toEqual(
      expect.objectContaining({ price_lbp: 900_000, extra_lbp: 100_000 }),
    );
    expect(p).not.toHaveProperty("extra_usd");
  });

  it("an extra above the price is capped at the price", async () => {
    render(<CustomServices />);
    fillUsd("0.5", "0.9");
    fireEvent.click(screen.getByTestId("stub-extra-1"));
    const p = await submitted();
    expect(p).toEqual(expect.objectContaining({ price_usd: 0.9, extra_usd: 0.9 }));
  });

  it("a discount is sent as discount_usd, the price net of it, no extra", async () => {
    render(<CustomServices />);
    fillUsd("20", "30");
    fireEvent.click(screen.getByTestId("stub-discount-2"));
    const p = await submitted();
    expect(p).toEqual(expect.objectContaining({ price_usd: 28, discount_usd: 2 }));
    expect(p).not.toHaveProperty("extra_usd");
  });

  it("no extra → no extra key (no default; offline replay)", async () => {
    render(<CustomServices />);
    fillUsd("7", "9");
    const p = await submitted();
    expect(p).not.toHaveProperty("extra_usd");
    expect(p).not.toHaveProperty("extra_lbp");
  });

  it("in a customer session: no extra mode, the basket line carries no extra", async () => {
    mockActiveSession = { id: 3 };
    render(<CustomServices />);
    fillUsd("7", "9");
    expect(mpiProps().extraMode).toBe(false);
    fireEvent.click(screen.getByTestId("stub-extra-1"));
    fireEvent.click(screen.getByText(/Submit Service|Add to/));
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const formData = createCustomServiceSchema.parse(
      mockAddToCart.mock.calls[0][0].formData,
    );
    expect(formData).not.toHaveProperty("extra_usd");
  });
});

/** @jest-environment jsdom */

/**
 * LIRA-185 (custom_services display lane) — the Services page's own profit
 * figures must agree with the Profits page for the same sale:
 *   1. the form's Profit preview includes change the cashier chose to keep
 *      (the core stamp adds kept_change to price − cost);
 *   2. a LOSS reads as a negative amount on the form preview, the Today's
 *      Profit card and the history Profit column — never "$0.00" (the old
 *      `usd > 0` / `lbp > 0` guards in three copies of formatCurrency).
 *
 * Scaffold copied from CustomServices.refundedHistoryDisplay.test.tsx (real
 * page, real useCustomServices hook, real DataTable), plus the REAL
 * StatsCards and a stable useApi mock (rule 25).
 *
 * Rule 17: written and run BEFORE the fix; the recorded red is in the task
 * report.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import CustomServices from "../index";

const mockAddCustomService = jest.fn();
const mockDeleteCustomService = jest.fn();
const mockGetClients = jest.fn();
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
const mockGetCustomServices = jest.fn();
const mockGetCustomServicesSummary = jest.fn();

// Rule 25: one module-level object so useApi() returns a STABLE reference.
const mockApi = {
  addCustomService: (...a: unknown[]) => mockAddCustomService(...a),
  deleteCustomService: (...a: unknown[]) => mockDeleteCustomService(...a),
  getClients: (...a: unknown[]) => mockGetClients(...a),
  getRates: () => Promise.resolve([]),
  getAllSettings: () => Promise.resolve([]),
  partners: { getAll: (...a: unknown[]) => mockPartnersGetAll(...a) },
  getCustomServices: (...a: unknown[]) => mockGetCustomServices(...a),
  getCustomServicesSummary: (...a: unknown[]) =>
    mockGetCustomServicesSummary(...a),
  servicePresets: {
    list: () => Promise.resolve({ success: true, data: [] }),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    useApi: () => mockApi,
    // Real DataTable — HistoryModal's renderRow must actually execute for
    // this test to mean anything (a fake that skips renderRow, like the
    // sibling CustomServices.test.tsx uses for its unrelated form tests,
    // would make every assertion below vacuously pass).
    DataTable: actual.DataTable,
    // HistoryModal renders the @liratek/ui DateRangeFilter (the only copy).
    DateRangeFilter: actual.DateRangeFilter,
    // The app's useModalFocusFix re-exports the @liratek/ui hook.
    useModalFocusFix: actual.useModalFocusFix,
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
    // Stand-in for the real widget's "Keep change" action: reports $1 kept,
    // exactly the shape MultiPaymentInput's onKeptChange emits.
    MultiPaymentInput: ({
      onKeptChange,
    }: {
      onKeptChange?: (k: { usd: number; lbp: number } | null) => void;
    }) => (
      <div data-testid="multi-payment-input">
        <button
          type="button"
          data-testid="keep-one-dollar"
          onClick={() => onKeptChange?.({ usd: 1, lbp: 0 })}
        >
          keep $1
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
  };
});

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

jest.mock("../../../../sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("../../../../sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: () => ({
    customerName: "",
    customerPhone: "",
  }),
}));

jest.mock("@/utils/exchangeRates", () => ({
  getExchangeRates: () => ({ buyRate: 89500, sellRate: 89500 }),
}));

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

jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

const LOSS_DESCRIPTION = "Loss-making job";
const LBP_LOSS_DESCRIPTION = "LBP loss job";

function historyRow(over: Record<string, unknown>) {
  return {
    id: 1,
    description: LOSS_DESCRIPTION,
    cost_usd: 10,
    cost_lbp: 0,
    price_usd: 4,
    price_lbp: 0,
    profit_usd: -6,
    profit_lbp: 0,
    paid_by: "CASH",
    status: "completed",
    client_id: null,
    client_name: null,
    phone_number: null,
    note: null,
    category: null,
    created_by: 1,
    created_at: "2026-09-10 09:00:00",
    edited_by: null,
    edited_at: null,
    is_refunded: 0,
    refunded_at: null,
    ...over,
  };
}

function fillCostAndPrice(costUsdStr: string, priceUsdStr: string) {
  const usdInputs = screen.getAllByPlaceholderText("0.00");
  fireEvent.change(usdInputs[0], { target: { value: costUsdStr } });
  fireEvent.change(usdInputs[1], { target: { value: priceUsdStr } });
}

describe("CustomServices — profit display agrees with Profits (LIRA-185)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClients.mockResolvedValue([]);
    mockPartnersGetAll.mockResolvedValue([]);
    mockGetCustomServicesSummary.mockResolvedValue({
      count: 0,
      totalCostUsd: 0,
      totalCostLbp: 0,
      totalPriceUsd: 0,
      totalPriceLbp: 0,
      totalProfitUsd: 0,
      totalProfitLbp: 0,
    });
    mockGetCustomServices.mockResolvedValue([]);
  });

  it("form preview: cost $3, price $5, $1 change kept -> Profit $3.00", async () => {
    const { container } = render(<CustomServices />);
    fillCostAndPrice("3", "5");
    expect(container.textContent).toContain("Profit: $2.00");
    fireEvent.click(screen.getByTestId("keep-one-dollar"));
    await waitFor(() =>
      expect(container.textContent).toContain("Profit: $3.00"),
    );
  });

  it("form preview: cost $10, price $4 -> Profit -$6.00, not $0.00", () => {
    const { container } = render(<CustomServices />);
    fillCostAndPrice("10", "4");
    expect(container.textContent).toContain("Profit: -$6.00");
  });

  it("Today's Profit card shows a loss as -$6.00", async () => {
    mockGetCustomServicesSummary.mockResolvedValue({
      count: 1,
      totalCostUsd: 10,
      totalCostLbp: 0,
      totalPriceUsd: 4,
      totalPriceLbp: 0,
      totalProfitUsd: -6,
      totalProfitLbp: 0,
    });
    render(<CustomServices />);
    const label = await screen.findByText("Today's Profit");
    await waitFor(() =>
      expect(label.parentElement?.textContent).toContain("-$6.00"),
    );
  });

  it("history Profit column shows a USD loss as -$6.00 and an LBP loss as -100,000 LBP", async () => {
    mockGetCustomServices.mockResolvedValue([
      historyRow({}),
      historyRow({
        id: 2,
        description: LBP_LOSS_DESCRIPTION,
        cost_usd: 0,
        price_usd: 0,
        cost_lbp: 400_000,
        price_lbp: 300_000,
        profit_usd: 0,
        profit_lbp: -100_000,
      }),
    ]);
    render(<CustomServices />);
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(LOSS_DESCRIPTION));
    const usdRow = screen.getByText(LOSS_DESCRIPTION).closest("tr");
    const lbpRow = screen.getByText(LBP_LOSS_DESCRIPTION).closest("tr");
    expect(
      within(usdRow as HTMLElement).getByText("-$6.00"),
    ).toBeInTheDocument();
    expect(
      within(lbpRow as HTMLElement).getByText("-100,000 LBP"),
    ).toBeInTheDocument();
  });
});

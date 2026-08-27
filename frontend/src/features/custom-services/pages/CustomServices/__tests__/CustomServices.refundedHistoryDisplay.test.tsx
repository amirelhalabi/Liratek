/** @jest-environment jsdom */

/**
 * Custom Services history — refunded-row display (LIRA-130)
 *
 * Owner report: a for-partner custom service ("7welet syria 100$", cost
 * $100 / price $110) was refunded. `transactions` was correct; the Custom
 * Services history still showed it as an ordinary live row with no refund
 * indication, and its profit column still read "$10.00" as if the sale
 * were still live.
 *
 * Root cause was split across two layers:
 *   1. Backend: `CustomServiceRepository.getColumns()` never selected
 *      `is_refunded`/`refunded_at`, so the field never reached the
 *      frontend (fixed — see CustomServiceRepository.refundedFlagProjection
 *      .test.ts for the backend-side proof).
 *   2. Frontend: the History modal's "Refunded" badge logic already
 *      existed (gated on `tx.is_refunded`) — it just never had real data to
 *      key off. The Profit column had NO refund-aware styling at all; it
 *      always rendered the raw generated profit_usd/profit_lbp value in
 *      "live" emerald/red colors regardless of `is_refunded`.
 *
 * This test drives the SAME boundary the real app uses: it mocks
 * `useApi().getCustomServices()` (the IPC/REST call `useCustomServices`
 * wraps) to return rows shaped exactly like the FIXED repository now
 * returns them, then renders the real `<CustomServices />` page, opens the
 * real `HistoryModal`, and asserts the rendered DOM — not a shallow props
 * check. This is the interaction-layer proof the ticket calls for: every
 * prior bug in this class (LIRA-119/121/122) was invisible to a
 * backend-only test because the failure was in what the UI does with data
 * it already has, exactly like the profit-column half of this bug.
 *
 * Rule 17 (failing-first): before the fix, the Profit column's className
 * ternary had no `isRefunded` branch at all (always
 * `tx.profit_usd >= 0 && tx.profit_lbp >= 0 ? "text-emerald-400" :
 * "text-red-400"`). With that reverted, "does not present a live profit for
 * a refunded row" FAILED (the refunded row's $10.00 rendered
 * `text-emerald-400`, indistinguishable from the live row) while the badge
 * assertion still passed (the badge logic pre-dated this fix). Confirmed
 * manually, then reverted — see the task report for the exact captured
 * output.
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

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    useApi: () => ({
      addCustomService: mockAddCustomService,
      deleteCustomService: mockDeleteCustomService,
      getClients: mockGetClients,
      getRates: jest.fn().mockResolvedValue([]),
      getAllSettings: jest.fn().mockResolvedValue([]),
      partners: { getAll: mockPartnersGetAll },
      // The real read path under test: useCustomServices() calls these two
      // directly through useApi() — NOT mocked at the hook level, so the
      // hook's real fetch/state-management code runs.
      getCustomServices: mockGetCustomServices,
      getCustomServicesSummary: mockGetCustomServicesSummary,
    }),
    // Real DataTable — HistoryModal's renderRow must actually execute for
    // this test to mean anything (a fake that skips renderRow, like the
    // sibling CustomServices.test.tsx uses for its unrelated form tests,
    // would make every assertion below vacuously pass).
    DataTable: actual.DataTable,
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
    MultiPaymentInput: () => <div data-testid="multi-payment-input" />,
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

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
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

const REFUNDED_DESCRIPTION = "7welet syria 100$";
const LIVE_DESCRIPTION = "Screen repair walk-in";

describe("CustomServices history — refunded row display (LIRA-130)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClients.mockResolvedValue([]);
    mockGetCustomServicesSummary.mockResolvedValue({
      count: 0,
      totalCostUsd: 0,
      totalCostLbp: 0,
      totalPriceUsd: 0,
      totalPriceLbp: 0,
      totalProfitUsd: 0,
      totalProfitLbp: 0,
    });
    // Shaped exactly like the FIXED CustomServiceRepository.getAll() now
    // returns rows — is_refunded/refunded_at present, one refunded, one not.
    mockGetCustomServices.mockResolvedValue([
      {
        id: 1,
        description: REFUNDED_DESCRIPTION,
        cost_usd: 100,
        cost_lbp: 0,
        price_usd: 110,
        price_lbp: 0,
        profit_usd: 10,
        profit_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        client_id: null,
        client_name: null,
        phone_number: null,
        note: null,
        category: null,
        created_by: 1,
        created_at: "2026-08-10 20:58:00",
        edited_by: null,
        edited_at: null,
        is_refunded: 1,
        refunded_at: "2026-08-10 21:05:00",
      },
      {
        id: 2,
        description: LIVE_DESCRIPTION,
        cost_usd: 5,
        cost_lbp: 0,
        price_usd: 13,
        price_lbp: 0,
        profit_usd: 8,
        profit_lbp: 0,
        paid_by: "CASH",
        status: "completed",
        client_id: null,
        client_name: null,
        phone_number: null,
        note: null,
        category: null,
        created_by: 1,
        created_at: "2026-08-10 20:00:00",
        edited_by: null,
        edited_at: null,
        is_refunded: 0,
        refunded_at: null,
      },
    ]);
  });

  async function openHistory() {
    render(<CustomServices />);
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(REFUNDED_DESCRIPTION));
    await waitFor(() => screen.getByText(LIVE_DESCRIPTION));
  }

  it("shows a Refunded badge on the refunded row and NOT on the live row", async () => {
    await openHistory();

    const refundedRow = screen.getByText(REFUNDED_DESCRIPTION).closest("tr");
    const liveRow = screen.getByText(LIVE_DESCRIPTION).closest("tr");
    expect(refundedRow).not.toBeNull();
    expect(liveRow).not.toBeNull();

    expect(
      within(refundedRow as HTMLElement).getByText("Refunded"),
    ).toBeInTheDocument();
    expect(
      within(liveRow as HTMLElement).queryByText("Refunded"),
    ).not.toBeInTheDocument();
  });

  it("does NOT present a live profit for the refunded row, while the live row's profit stays live", async () => {
    await openHistory();

    const refundedRow = screen.getByText(REFUNDED_DESCRIPTION).closest("tr");
    const liveRow = screen.getByText(LIVE_DESCRIPTION).closest("tr");

    // Refunded row: profit_usd=10 -> "$10.00", must NOT carry the live
    // emerald styling, and must be visually neutralized (struck through).
    const refundedProfit = within(refundedRow as HTMLElement).getByText(
      "$10.00",
    );
    expect(refundedProfit.className).not.toContain("text-emerald-400");
    expect(refundedProfit.className).toContain("line-through");

    // Live row: profit_usd=8 -> "$8.00", unaffected — still the live
    // positive-profit color, never struck through.
    const liveProfit = within(liveRow as HTMLElement).getByText("$8.00");
    expect(liveProfit.className).toContain("text-emerald-400");
    expect(liveProfit.className).not.toContain("line-through");
  });

  it("still shows the correct raw cost/price on the refunded row — presentation only, no money value is hidden or altered", async () => {
    await openHistory();

    const refundedRow = screen.getByText(REFUNDED_DESCRIPTION).closest("tr");
    // Cost $100.00 and Price $110.00 (the ↑ badge) both still present,
    // proving this fix only touches how the row is STYLED, never what
    // financial data is shown.
    expect(
      within(refundedRow as HTMLElement).getByText("$100.00"),
    ).toBeInTheDocument();
    expect(
      within(refundedRow as HTMLElement).getAllByText(/\$110\.00/).length,
    ).toBeGreaterThan(0);
  });
});

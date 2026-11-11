/** @jest-environment jsdom */

/**
 * LIRA-384 B — once an AT_SETTLEMENT (commission_model = 1) row is settled,
 * the History "Profit" cell shows the row's share of the settlement
 * commission (`settled_commission_usd/lbp`, what Profits counts), not the
 * booking-time estimate; the estimate (with its badge) only while unsettled.
 * Embedded (model 0) rows keep their booked commission.
 *
 * Rule 17: run red before the fix (see report).
 * rule 25: the useApi mock returns ONE stable object.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import Services from "../index";

const SETTLED_LBP = "Settled LBP Client";
const SETTLED_NONE = "Settled No Share Client";
const SETTLED_CROSS = "Settled Cross Client";
const OPEN_LBP = "Open LBP Client";
const EMBEDDED_USD = "Embedded USD Client";

const mockGetOMTHistory = jest.fn();
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
// rule 25: ONE stable api object, never a fresh literal per useApi() call.
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: jest.fn().mockResolvedValue({ success: true, id: 1 }),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    // Real DataTable — the inline history table's renderRow must actually
    // execute for this test to mean anything.
    DataTable: actual.DataTable,
    Select: ({
      value,
      onChange,
      options,
    }: {
      value: string;
      onChange: (v: string) => void;
      options: { value: string; label: string }[];
    }) => (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
    MultiPaymentInput: () => <div data-testid="multi-payment-input" />,
    TopUpModal: () => null,
  };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
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

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const row = (o: Record<string, unknown>) => ({
  provider: "OMT",
  service_type: "SEND",
  omt_service_type: "INTRA",
  whish_fee: null,
  omt_fee: 0,
  is_refunded: 0,
  created_at: "2026-10-01 10:00:00",
  ...o,
});

describe("Services page — History shows the settled commission share (LIRA-384)", () => {
  beforeEach(() => {
    mockGetOMTAnalytics.mockResolvedValue({
      today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
      month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
      byProvider: [],
    });
    mockGetSuppliers.mockResolvedValue([]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockPartnersGetAll.mockResolvedValue([]);
    // Shaped like FinancialServiceRepository.getHistory() rows.
    mockGetOMTHistory.mockResolvedValue([
      row({
        id: 1,
        amount: 1_000_000,
        currency: "LBP",
        commission: 10_000,
        commission_model: 1,
        is_settled: 1,
        settled_commission_usd: 0,
        settled_commission_lbp: 15_001,
        client_name: SETTLED_LBP,
      }),
      row({
        id: 2,
        amount: 1_000_000,
        currency: "LBP",
        commission: 10_000,
        commission_model: 1,
        is_settled: 1,
        settled_commission_usd: null,
        settled_commission_lbp: null,
        client_name: SETTLED_NONE,
      }),
      row({
        id: 3,
        amount: 1_000_000,
        currency: "LBP",
        commission: 10_000,
        commission_model: 1,
        is_settled: 1,
        settled_commission_usd: 1,
        settled_commission_lbp: 0,
        client_name: SETTLED_CROSS,
      }),
      row({
        id: 4,
        amount: 500_000,
        currency: "LBP",
        commission: 5_000,
        commission_model: 1,
        is_settled: 0,
        settled_commission_usd: null,
        settled_commission_lbp: null,
        client_name: OPEN_LBP,
      }),
      row({
        id: 5,
        amount: 100,
        currency: "USD",
        commission: 0.1,
        commission_model: 0,
        is_settled: 1,
        settled_commission_usd: null,
        settled_commission_lbp: null,
        client_name: EMBEDDED_USD,
      }),
    ]);
  });

  async function openHistory() {
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(SETTLED_LBP));
  }

  function profitCell(clientName: string): HTMLElement {
    const tr = screen.getByText(clientName).closest("tr") as HTMLElement;
    const table = tr.closest("table") as HTMLElement;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => (h.textContent ?? "").trim());
    const i = headers.findIndex((h) => h.startsWith("Profit"));
    expect(i).toBeGreaterThanOrEqual(0);
    return within(tr).getAllByRole("cell")[i] as HTMLElement;
  }

  it("settled model-1 row: its settled share, not the estimate, no badge", async () => {
    await openHistory();
    const cell = profitCell(SETTLED_LBP);
    expect(cell.textContent).toContain("15,001 LBP");
    expect(cell.textContent).not.toContain("10,000");
    expect(cell.textContent).not.toMatch(/est\./i);
  });

  it("settled model-1 row with no allocation: 0, never the estimate", async () => {
    await openHistory();
    const cell = profitCell(SETTLED_NONE);
    expect(cell.textContent).toContain("0 LBP");
    expect(cell.textContent).not.toContain("10,000");
    expect(cell.textContent).not.toMatch(/est\./i);
  });

  it("settled LBP row whose share came in USD shows the USD share", async () => {
    await openHistory();
    const cell = profitCell(SETTLED_CROSS);
    expect(cell.textContent).toContain("$1.0000");
    expect(cell.textContent).not.toContain("10,000");
  });

  it("unsettled model-1 row: the estimate with its badge", async () => {
    await openHistory();
    const cell = profitCell(OPEN_LBP);
    expect(cell.textContent).toContain("5,000 LBP");
    expect(cell.textContent).toMatch(/est\./i);
  });

  it("embedded model-0 row: its booked commission, no badge", async () => {
    await openHistory();
    const cell = profitCell(EMBEDDED_USD);
    expect(cell.textContent).toContain("$0.1000");
    expect(cell.textContent).not.toMatch(/est\./i);
  });
});

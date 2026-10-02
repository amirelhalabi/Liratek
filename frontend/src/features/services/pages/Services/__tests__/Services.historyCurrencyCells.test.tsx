/** @jest-environment jsdom */

/**
 * Services page — history table Fee/Profit cells must be denominated in the
 * row's own currency, and an unsettled AT_SETTLEMENT (commission_model = 1)
 * commission must read as an estimate (LIRA-185 display lead 1).
 *
 * The bug this guards: the Fee cell rendered `$${fee.toFixed(2)}` and the
 * Profit cell `$${commission.toFixed(4)}` for every row, so an OMT INTRA
 * SEND of 3,000,000 LBP (fee 50,000 LBP, model-1 commission estimate 5,000
 * LBP, which every money surface books as 0 until the supplier settles)
 * printed "$50000.00" of fee and "$5000.0000" of profit.
 *
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

const LBP_CLIENT = "LBP Estimate Client";
const USD_CLIENT = "USD Settled Client";

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

describe("Services page — history Fee/Profit cells use the row currency (LIRA-185 lead 1)", () => {
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
      {
        id: 1,
        provider: "OMT",
        service_type: "SEND",
        omt_service_type: "INTRA",
        amount: 3_000_000,
        currency: "LBP",
        commission: 5000,
        commission_model: 1,
        omt_fee: 50_000,
        whish_fee: null,
        is_settled: 0,
        client_name: LBP_CLIENT,
        created_at: "2026-10-01 10:00:00",
        is_refunded: 0,
      },
      {
        id: 2,
        provider: "OMT",
        service_type: "SEND",
        omt_service_type: "INTRA",
        amount: 100,
        currency: "USD",
        commission: 0.1,
        commission_model: 0,
        omt_fee: 1,
        whish_fee: null,
        is_settled: 0,
        client_name: USD_CLIENT,
        created_at: "2026-10-01 09:00:00",
        is_refunded: 0,
      },
    ]);
  });

  async function openHistory() {
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(LBP_CLIENT));
    await waitFor(() => screen.getByText(USD_CLIENT));
  }

  /** Cells of a row, indexed by the table's own header text. */
  function cellsByHeader(clientName: string) {
    const row = screen.getByText(clientName).closest("tr") as HTMLElement;
    const table = row.closest("table") as HTMLElement;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => (h.textContent ?? "").trim());
    const cells = within(row).getAllByRole("cell");
    const at = (name: string) => {
      const i = headers.findIndex((h) => h.startsWith(name));
      expect(i).toBeGreaterThanOrEqual(0);
      return cells[i] as HTMLElement;
    };
    return { fee: at("Fee"), profit: at("Profit") };
  }

  it("LBP row: fee and profit print in LBP (no $), and the unsettled model-1 commission is marked as an estimate", async () => {
    await openHistory();
    const { fee, profit } = cellsByHeader(LBP_CLIENT);

    expect(fee.textContent).toContain("50,000 LBP");
    expect(fee.textContent).not.toContain("$");

    expect(profit.textContent).toContain("5,000 LBP");
    expect(profit.textContent).not.toContain("$");
    expect(profit.textContent).toMatch(/est\./i);
  });

  it("USD model-0 row: keeps the $ format (4-decimal commission) and is NOT marked as an estimate", async () => {
    await openHistory();
    const { fee, profit } = cellsByHeader(USD_CLIENT);

    expect(fee.textContent).toContain("$1.00");
    expect(profit.textContent).toContain("$0.1000");
    expect(profit.textContent).not.toMatch(/est\./i);
  });
});

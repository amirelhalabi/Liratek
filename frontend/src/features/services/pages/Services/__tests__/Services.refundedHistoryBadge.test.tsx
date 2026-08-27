/** @jest-environment jsdom */

/**
 * Services page — inline OMT/Whish history table had NO refund display at
 * all (LIRA-131's audit table: "Split — services/pages/Services/index.tsx
 * inline table has NO badge code at all", the only one of the five modules
 * needing real UI built rather than a starved-badge one-line fix).
 *
 * `financial_services` is in `TransactionRepository._markSourceRefunded`'s
 * supported-tables whitelist (migration v68) — a void/refund of an OMT/Whish
 * transaction correctly sets `is_refunded = 1` / `refunded_at`. Root cause
 * was `FinancialServiceRepository.getColumns()` never projecting either
 * column (fixed in this same change, see
 * FinancialServiceRepository.refundedRead.test.ts) — but UNLIKE the sibling
 * recharge/exchange/expenses/debts surfaces, this page's inline history
 * `renderRow` never had ANY refund-aware JSX to light up. This test drives
 * the real page, the real DataTable, and the newly-added badge + neutralised
 * profit styling.
 *
 * Rule 17 (failing-first): the badge JSX added to Services/index.tsx's
 * renderRow did not exist before this change — temporarily removing it (and
 * the `isRefunded` row-dim class) makes both assertions below fail (no
 * "Refunded" text node found in the refunded row; the live row's $0.0050
 * commission cell keeps `text-emerald-400` in BOTH cases, i.e.
 * indistinguishable from a refunded row) — confirmed manually, then
 * reverted (see task report for the exact captured output).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import Services from "../index";

const REFUNDED_CLIENT = "Refunded Client";
const LIVE_CLIENT = "Live Client";

const mockGetOMTHistory = jest.fn();
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getOMTHistory: mockGetOMTHistory,
      getOMTAnalytics: mockGetOMTAnalytics,
      getSuppliers: mockGetSuppliers,
      getSupplierBalances: mockGetSupplierBalances,
      partners: { getAll: mockPartnersGetAll },
      addOMTTransaction: jest.fn().mockResolvedValue({ success: true, id: 1 }),
    }),
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

describe("Services page — inline OMT/Whish history table refunded badge (LIRA-131)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOMTAnalytics.mockResolvedValue({
      today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
      month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
      byProvider: [],
    });
    mockGetSuppliers.mockResolvedValue([]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockPartnersGetAll.mockResolvedValue([]);
    // Shaped exactly like the FIXED FinancialServiceRepository.getHistory()
    // now returns rows — is_refunded/refunded_at present, one refunded, one
    // not.
    mockGetOMTHistory.mockResolvedValue([
      {
        id: 1,
        provider: "OMT",
        service_type: "SEND",
        amount: 100,
        currency: "USD",
        commission: 5,
        omt_fee: 0,
        whish_fee: 0,
        is_settled: 1,
        client_name: REFUNDED_CLIENT,
        created_at: "2026-08-10 20:00:00",
        is_refunded: 1,
        refunded_at: "2026-08-10 21:00:00",
      },
      {
        id: 2,
        provider: "OMT",
        service_type: "SEND",
        amount: 50,
        currency: "USD",
        commission: 3,
        omt_fee: 0,
        whish_fee: 0,
        is_settled: 1,
        client_name: LIVE_CLIENT,
        created_at: "2026-08-10 19:00:00",
        is_refunded: 0,
        refunded_at: null,
      },
    ]);
  });

  async function openHistory() {
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
    fireEvent.click(screen.getByText("History"));
    await waitFor(() => screen.getByText(REFUNDED_CLIENT));
    await waitFor(() => screen.getByText(LIVE_CLIENT));
  }

  it("shows a Refunded badge on the refunded row and NOT on the live row", async () => {
    await openHistory();

    const refundedRow = screen.getByText(REFUNDED_CLIENT).closest("tr");
    const liveRow = screen.getByText(LIVE_CLIENT).closest("tr");
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

    const refundedRow = screen.getByText(REFUNDED_CLIENT).closest("tr");
    const liveRow = screen.getByText(LIVE_CLIENT).closest("tr");

    // Refunded row: commission=5 -> "$5.0000", must NOT carry the live
    // emerald styling, and must be visually neutralized (struck through).
    const refundedProfit = within(refundedRow as HTMLElement).getByText(
      "$5.0000",
    );
    expect(refundedProfit.className).not.toContain("text-emerald-400");
    expect(refundedProfit.className).toContain("line-through");

    // Live row: commission=3 -> "$3.0000", unaffected.
    const liveProfit = within(liveRow as HTMLElement).getByText("$3.0000");
    expect(liveProfit.className).toContain("text-emerald-400");
    expect(liveProfit.className).not.toContain("line-through");
  });
});

/**
 * G40 — voided supplier transactions (LIRA-258).
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Suppliers from "../index";

const mockGetSuppliers = jest.fn();
const mockGetSupplierBalances = jest.fn();
const mockGetSupplierProductBalances = jest.fn();
const mockGetSupplierLedger = jest.fn();
const mockGetSupplierProductItems = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockSettleTransactions = jest.fn();
const mockAppEventsEmit = jest.fn();

// Spread the REAL module first (`jest.requireActual`) — this page now also
// imports the shared, presentation-only balance colour helpers
// (`BALANCE_EPS`/`balanceBucket`/`balanceTextColor`, `@liratek/ui`, Balance
// Pages colour audit 2026-08-11), which a plain object-literal mock like the
// old one here would silently turn into `undefined` (a `TypeError` at
// render, not a status-badge mismatch). Only the pieces below need
// stubbing — everything else stays real.
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getSuppliers: mockGetSuppliers,
      getSupplierBalances: mockGetSupplierBalances,
      // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the page now always
      // fetches this too; none of this file's cases exercise an account
      // parent, so a static empty array (no account on this tenant) keeps
      // every existing assertion byte-for-byte unaffected.
      getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
      getSupplierProductBalances: mockGetSupplierProductBalances,
      getSupplierLedger: mockGetSupplierLedger,
      getSupplierProductItems: mockGetSupplierProductItems,
      getAllSupplierTransactions: mockGetAllSupplierTransactions,
      getUnsettledTransactions: mockGetUnsettledTransactions,
      settleTransactions: mockSettleTransactions,
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
    }),
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
    CounterpartySettleModal: () => null,
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
      </div>
    ),
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

const KATSH_SUPPLIER = {
  id: 1,
  name: "Katsh",
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  provider: "Katsh",
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
};

// A plain Katsh ITEM sale (not a bill) — post-C5, `supplier_debt_booked = 0`
// at the repository (the default since migration v115). The owner's exact
// report: bought/sold via Katsh's own topped-up balance, nothing owed.
// `supplier_owed`/`fifo_status` are the FIXED FinancialService.getAllByProvider
// output for this row (see FinancialServiceRepository.saleCost.test.ts).
// G40 (LIRA-258, found on cornertech 2026-10-06): a VOIDED row still showed
// "Unpaid" in the Transactions history and was counted in the unpaid tally
// and the "Outstanding" total. FinancialService.getAllByProvider now returns
// fifo_status "voided" for such rows (core guard:
// FinancialService.voidedFifoStatus.test.ts).
const VOIDED_ROW = {
  id: 501,
  service_type: "SEND" as const,
  amount: 90,
  currency: "USD",
  commission: 0,
  cost: 90,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: null,
  is_settled: 1,
  is_refunded: 1,
  supplier_owed: 90,
  fifo_status: "voided" as const,
  fifo_paid_usd: 0,
  created_at: "2026-10-06T18:57:58Z",
};

const LIVE_UNPAID_ROW = {
  ...VOIDED_ROW,
  id: 502,
  is_refunded: 0,
  fifo_status: "unpaid" as const,
  created_at: "2026-10-06T19:10:00Z",
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Suppliers />
    </QueryClientProvider>,
  );
}

describe("Suppliers page — voided rows in the Transactions history (G40)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: 90, total_lbp: 0 },
    ]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    mockGetAllSupplierTransactions.mockResolvedValue([
      LIVE_UNPAID_ROW,
      VOIDED_ROW,
    ]);
  });

  it("shows a voided row as Voided, never Unpaid", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByText("Katsh"))[0]);

    const voided = await screen.findByTestId("supplier-txn-row-501");
    expect(within(voided).queryByText("Unpaid")).toBeNull();
    expect(within(voided).getByText("Voided")).toBeInTheDocument();

    const live = await screen.findByTestId("supplier-txn-row-502");
    expect(within(live).getByText("Unpaid")).toBeInTheDocument();
  });

  it("leaves the voided row out of the unpaid count and the Outstanding total", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByText("Katsh"))[0]);

    await screen.findByTestId("supplier-txn-row-501");
    expect(screen.getByText(/1\s*unpaid/)).toBeInTheDocument();
    expect(screen.getByText("Outstanding: $90.00")).toBeInTheDocument();
  });
});

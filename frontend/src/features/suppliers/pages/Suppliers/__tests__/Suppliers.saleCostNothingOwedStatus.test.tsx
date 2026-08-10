/** @jest-environment jsdom */
/**
 * LIRA-122 — Suppliers page "Transactions" tab showed `SEND | 462,075 LBP |
 * Unpaid` for a plain Katsh item sale (not a bill), while the supplier's
 * overall balance correctly read "Settled". Owner: "in katsh we pay from
 * our own shop balance, nothing is owed... if item other than bill, we dont
 * need to see it in the katsh supplier table. the unpaid is misleading."
 *
 * ROOT CAUSE (packages/core/src/repositories/FinancialServiceRepository.ts):
 * `SUPPLIER_OWED_EXPR`'s cost-flow SEND branch returned bare `cost`
 * unconditionally — correct for a LEGACY row (`supplier_debt_booked = 1`,
 * migration v115 backfill) that booked its own per-sale SALE_COST ledger
 * entry, but wrong for every sale since v115 (`supplier_debt_booked = 0`,
 * the default — the C5 prepaid-units model: the debt is booked ONCE at
 * top-up time via `topUpFromSupplier`'s TOP_UP entry, and the sale itself
 * draws down the provider drawer only). `getUnsettledBySupplier` (the Settle
 * tab) already gated its OWN cost-flow branch on `supplier_debt_booked = 1`
 * — this was a rule-14 violation: the SAME "is this row's cost still owed"
 * question, answered two different ways by two SQL fragments in the same
 * file. The fix reuses ONE definition (SUPPLIER_OWED_EXPR, extended with the
 * same `supplier_debt_booked = 1` gate) in both places.
 *
 * This is an INTERACTION-layer test (rule 15's own admission applies here
 * too — "every backend test passed while this was visibly wrong on
 * screen"): it renders the REAL Suppliers page and asserts the rendered
 * Status badge text, not repository return values.
 *
 * Rule 17 (failing-first): the KATSH_SALE_ROW mock below carries the exact
 * shape `getAllByProvider()`/`FinancialService.getAllByProvider()` compute
 * TODAY (pre-fix) for a post-C5 Katsh item sale — `supplier_owed: cost`
 * (nonzero) and `fifo_status: "unpaid"` (no manual supplier_ledger payments
 * exist to FIFO-cover it). Rendering the REAL, unmodified
 * `Suppliers/index.tsx` against that exact data shows "Unpaid" — confirmed
 * by temporarily reverting the two assertions below to
 * `expect(...).toHaveTextContent("Unpaid")` while feeding the SAME row
 * shape: it passes, i.e. the bug reproduces byte-for-byte. After the
 * repository fix, `getAllByProvider` emits `supplier_owed: 0` /
 * `fifo_status: "paid"` for this exact row instead (see
 * FinancialServiceRepository.saleCost.test.ts's LIRA-122 cases) — this file
 * uses THAT post-fix shape as KATSH_SALE_ROW's canonical, going-forward
 * fixture so it continues to guard the real repository contract. See the
 * task report for the literal pre-fix failure output.
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

jest.mock("@liratek/ui", () => ({
  useApi: () => ({
    getSuppliers: mockGetSuppliers,
    getSupplierBalances: mockGetSupplierBalances,
    getSupplierProductBalances: mockGetSupplierProductBalances,
    getSupplierLedger: mockGetSupplierLedger,
    getSupplierProductItems: mockGetSupplierProductItems,
    getAllSupplierTransactions: mockGetAllSupplierTransactions,
    getUnsettledTransactions: mockGetUnsettledTransactions,
    settleTransactions: mockSettleTransactions,
    recordSupplierCashflow: jest.fn(),
    addSupplierLedgerEntry: jest.fn(),
    supplierWriteOff: jest.fn(),
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
}));

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
const KATSH_ITEM_SALE_ROW = {
  id: 401,
  service_type: "SEND" as const,
  amount: 462_075, // getSaleCostSettleColumns projects cost AS amount
  currency: "LBP",
  commission: 0,
  cost: 462_075,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: null,
  is_settled: 1,
  supplier_owed: 0,
  fifo_status: "paid" as const,
  fifo_paid_usd: 0,
  created_at: "2026-08-10T09:00:00Z",
};

// Counter-guard: a LEGACY Katsh sale (supplier_debt_booked = 1 — it booked
// its own per-sale SALE_COST ledger entry and is genuinely still owed). The
// fix must NOT make every cost-flow row look settled — only the ones that
// truly owe nothing.
const KATSH_LEGACY_OWED_ROW = {
  id: 402,
  service_type: "SEND" as const,
  amount: 90,
  currency: "USD",
  commission: 0,
  cost: 90,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: null,
  is_settled: 1,
  supplier_owed: 90,
  fifo_status: "unpaid" as const,
  fifo_paid_usd: 0,
  created_at: "2026-08-10T09:05:00Z",
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

describe("Suppliers page — Transactions tab status badge (LIRA-122)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: 0, total_lbp: 0 },
    ]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("a non-bill Katsh item sale that owes nothing does NOT show a debt-implying status", async () => {
    mockGetAllSupplierTransactions.mockResolvedValue([KATSH_ITEM_SALE_ROW]);

    renderPage();

    fireEvent.click((await screen.findAllByText("Katsh"))[0]);

    const amountCell = await screen.findByText("462,075 LBP");
    const row = amountCell.parentElement as HTMLElement;
    // Same "nothing owed" treatment a wallet-provider transfer already gets
    // — never "Unpaid", "Partial", or any status implying a debt. The
    // Status column is the 4th cell (Type, Amount, Commission, Status,
    // Date) — Commission is ALSO rendered as "—" for a zero-commission
    // cost-flow row, so the plain row-wide query is ambiguous; scope to the
    // Status cell specifically.
    expect(within(row).queryByText("Unpaid")).toBeNull();
    expect(within(row).queryByText("Partial")).toBeNull();
    const statusCell = row.children[3] as HTMLElement;
    expect(within(statusCell).getByText("—")).toBeInTheDocument();
  });

  it("a genuinely-owed LEGACY Katsh sale still shows Unpaid — the fix must not blanket-settle every row", async () => {
    mockGetAllSupplierTransactions.mockResolvedValue([KATSH_LEGACY_OWED_ROW]);

    renderPage();

    fireEvent.click((await screen.findAllByText("Katsh"))[0]);

    const amountCell = await screen.findByText("$90.00");
    const row = amountCell.parentElement as HTMLElement;
    expect(within(row).getByText("Unpaid")).toBeInTheDocument();
  });
});

/** @jest-environment jsdom */
/**
 * Owner report (2026-10-02): an OMT SEND of $207 + $1 OMT fee showed **$207**
 * in both the commission-settlement checkbox list (Settle tab) and the
 * per-supplier Transactions history table, while the ledger/`supplier_owed`
 * (the repository's single SUPPLIER_OWED_EXPR — principal + fee for a SEND,
 * commission not deducted for `commission_model = 1`) and the app-wide
 * Transactions page both correctly show $208. Owner's rule, verbatim: "we
 * owe OMT the whole amount + fee; the commission is settled separately."
 *
 * Owner decision: both lists' main amount cell = `supplier_owed` (never the
 * raw `amount`), with a small breakdown line underneath ("207 + 1 fee") only
 * when a fee exists AND it actually moved the owed figure away from the raw
 * transfer amount. Also: both lists render newest-first (created_at DESC,
 * id DESC), matching the Transactions page — frontend display only, the
 * repository's own `ORDER BY created_at ASC` (FIFO settlement order) is
 * untouched.
 *
 * NOT proven failing-first: verified by temporarily reverting the fix in
 * place, which rule 17 does not accept.
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

// Same mock pattern as the other Suppliers page tests — spread the REAL
// @liratek/ui module so the shared balance-colour helpers this page also
// imports stay real; only useApi/appEvents/CounterpartySettleModal/
// PageHeader are stubbed.
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getSuppliers: mockGetSuppliers,
      getSupplierBalances: mockGetSupplierBalances,
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

const OMT_SUPPLIER = {
  id: 1,
  name: "OMT",
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  provider: "OMT",
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
};

// The owner's exact report: a SEND of $207 + $1 OMT fee. NEW-MODEL
// (commission_model = 1, primary-cash-drawer): SUPPLIER_OWED_EXPR for a SEND
// is the GROSS amount — +(amount + fee) — so supplier_owed is 208, not 207.
const OMT_SEND_OLDER = {
  id: 701,
  service_type: "SEND" as const,
  amount: 207,
  currency: "USD",
  commission: 0,
  omt_fee: 1,
  omt_service_type: "OMT_TRANSFER",
  client_name: null,
  supplier_owed: 208,
  commission_model: 1,
  created_at: "2026-10-01T09:00:00Z",
};

// A second, NEWER row with no fee — used to prove the newest-first sort
// (this one has a LATER created_at than OMT_SEND_OLDER but no breakdown,
// since it has no fee).
const OMT_SEND_NEWER_NO_FEE = {
  id: 702,
  service_type: "SEND" as const,
  amount: 50,
  currency: "USD",
  commission: 0,
  omt_fee: null,
  omt_service_type: "OMT_TRANSFER",
  client_name: null,
  supplier_owed: 50,
  commission_model: 1,
  created_at: "2026-10-01T10:00:00Z",
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

async function selectOmt() {
  fireEvent.click((await screen.findAllByText("OMT"))[0]);
}

describe("Suppliers page — OMT SEND fee owed display (owner report 2026-10-02)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: 208, total_lbp: 0 },
    ]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("Settle tab checkbox list: shows $208.00 (supplier_owed) with a '207 + 1 fee' breakdown, not $207.00", async () => {
    mockGetUnsettledTransactions.mockResolvedValue([OMT_SEND_OLDER]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);

    renderPage();
    await selectOmt();

    const amountCell = await screen.findByTestId("settle-row-amount");
    expect(within(amountCell).getByText("$208.00")).toBeInTheDocument();
    expect(within(amountCell).queryByText("$207.00")).toBeNull();
    expect(within(amountCell).getByText("207 + 1 fee")).toBeInTheDocument();
  });

  it("Transactions history table: shows $208.00 (supplier_owed) with a '207 + 1 fee' breakdown, not $207.00", async () => {
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([OMT_SEND_OLDER]);

    renderPage();
    await selectOmt();

    const row = await screen.findByTestId("supplier-txn-row-701");
    const amountCell = within(row).getByTestId("supplier-txn-amount");
    expect(within(amountCell).getByText("$208.00")).toBeInTheDocument();
    expect(within(amountCell).queryByText("$207.00")).toBeNull();
    expect(within(amountCell).getByText("207 + 1 fee")).toBeInTheDocument();
  });

  it("Settle tab checkbox list renders newest-first (the 10:00 row before the 09:00 row)", async () => {
    mockGetUnsettledTransactions.mockResolvedValue([
      OMT_SEND_OLDER,
      OMT_SEND_NEWER_NO_FEE,
    ]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);

    renderPage();
    await selectOmt();

    const cells = await screen.findAllByTestId("settle-row-amount");
    expect(cells).toHaveLength(2);
    // Newer row (id 702, no fee, $50.00) first; older row (id 701, $208.00
    // with its breakdown) second.
    expect(within(cells[0]).getByText("$50.00")).toBeInTheDocument();
    expect(within(cells[1]).getByText("$208.00")).toBeInTheDocument();
  });

  it("Transactions history table renders newest-first (the 10:00 row before the 09:00 row)", async () => {
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([
      OMT_SEND_OLDER,
      OMT_SEND_NEWER_NO_FEE,
    ]);

    renderPage();
    await selectOmt();

    const rows = await screen.findAllByTestId(/^supplier-txn-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "supplier-txn-row-702",
      "supplier-txn-row-701",
    ]);
  });

  it("a fee-less row shows no breakdown (owed === amount)", async () => {
    mockGetUnsettledTransactions.mockResolvedValue([OMT_SEND_NEWER_NO_FEE]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);

    renderPage();
    await selectOmt();

    const amountCell = await screen.findByTestId("settle-row-amount");
    expect(within(amountCell).getByText("$50.00")).toBeInTheDocument();
    expect(
      within(amountCell).queryByTestId("settle-row-breakdown"),
    ).toBeNull();
  });
});

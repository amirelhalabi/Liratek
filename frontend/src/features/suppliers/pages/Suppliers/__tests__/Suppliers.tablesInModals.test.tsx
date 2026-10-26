/** @jest-environment jsdom */
/**
 * Owner request (2026-10-16) — the selected supplier's Transactions history
 * and Payments ledger no longer render inline (the page got long). Each has
 * a button in the supplier header showing its row count; clicking opens a
 * modal with that table on its own. Escape, the X and a backdrop click close
 * it. The Commission Settlement tick list (the batch-settle flow's own
 * picker) stays inline — it never depended on the history table.
 *
 * Rule 17: written before the change and run against the old page first.
 */

import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Suppliers from "../index";
import { openSupplierTable } from "@/features/suppliers/testing/supplierTableModals";

const mockGetSuppliers = jest.fn();
const mockGetSupplierLedger = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetUnsettledTransactions = jest.fn();

// Rule 25 — one module-level object, never a fresh literal per useApi() call.
const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getSupplierLedger: mockGetSupplierLedger,
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: mockGetAllSupplierTransactions,
  getUnsettledTransactions: mockGetUnsettledTransactions,
  settleTransactions: jest.fn(),
  recordSupplierCashflow: jest.fn(),
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn(),
  createSupplierPurchase: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
    CounterpartySettleModal: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="settle-modal">{children}</div>
    ),
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  };
});

let mockRole = "admin";
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: mockRole, role: mockRole } }),
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

const KATSH = {
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

const TXN = {
  service_type: "BILL" as const,
  currency: "USD",
  amount: 10,
  commission: 0,
  cost: 10,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: null,
  is_settled: 0,
  supplier_owed: 10,
  fifo_status: "unpaid" as const,
  fifo_paid_usd: 0,
};
const TXN_A = { ...TXN, id: 801, created_at: "2026-10-01T09:00:00Z" };
const TXN_B = { ...TXN, id: 802, created_at: "2026-10-01T10:00:00Z" };

const LEDGER_ROW = {
  id: 901,
  supplier_id: 1,
  entry_type: "PAYMENT" as const,
  amount_usd: -5,
  amount_lbp: 0,
  note: "Cash paid to Katsh rep",
  created_by: 1,
  transaction_id: 1000,
  is_refunded: 0,
  refunded_at: null,
  created_at: "2026-10-02T10:00:00Z",
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

async function selectKatsh() {
  fireEvent.click(await screen.findByTestId("supplier-tile-Katsh"));
}

describe("Suppliers page — Transactions and Payments open in their own modal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockGetSuppliers.mockResolvedValue([KATSH]);
    mockGetSupplierLedger.mockResolvedValue([LEDGER_ROW]);
    mockGetAllSupplierTransactions.mockResolvedValue([TXN_A, TXN_B]);
    mockGetUnsettledTransactions.mockResolvedValue([TXN_A]);
  });

  it("does not render either table inline; the two buttons carry the row counts", async () => {
    renderPage();
    await selectKatsh();

    expect(
      await screen.findByRole("button", { name: "Transactions (2)" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Payments (1)" }),
    ).toBeInTheDocument();

    expect(screen.queryByTestId("supplier-txn-row-801")).toBeNull();
    expect(screen.queryByTestId("supplier-txn-row-802")).toBeNull();
    expect(screen.queryByText("Cash paid to Katsh rep")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the Transactions button opens a modal with the history table; Escape closes it", async () => {
    renderPage();
    await selectKatsh();

    fireEvent.click(
      await screen.findByRole("button", { name: "Transactions (2)" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Katsh — Transactions",
    });
    expect(
      within(dialog).getByTestId("supplier-txn-row-801"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("supplier-txn-row-802"),
    ).toBeInTheDocument();
    // Footer tallies move with the table.
    expect(within(dialog).getByText(/Outstanding: \$20\.00/)).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("supplier-txn-row-801")).toBeNull();
  });

  it("the Payments button opens a modal with the ledger; the X and a backdrop click close it", async () => {
    renderPage();
    await selectKatsh();

    fireEvent.click(
      await screen.findByRole("button", { name: "Payments (1)" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Katsh — Payments",
    });
    expect(
      within(dialog).getByText("Cash paid to Katsh rep"),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Payments (1)" }));
    await screen.findByRole("dialog", { name: "Katsh — Payments" });
    fireEvent.mouseDown(screen.getByTestId("supplier-table-modal-backdrop"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the Commission Settlement tick list stays inline and still selects rows (batch settle needs no modal)", async () => {
    renderPage();
    await selectKatsh();

    expect(await screen.findByText("Commission Settlement")).toBeTruthy();
    const row = await screen.findByTestId("settle-row-801");
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(
      await screen.findByRole("button", { name: "Settle (1)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Written AFTER the change (not proven failing-first): the old tab bar
  // always offered the history tab, so there was no empty tab to guard.
  it("a staff user gets no empty Settle tab and is not pushed onto Pay / Receive; the Transactions button still opens the history", async () => {
    mockRole = "staff";
    renderPage();
    await selectKatsh();

    // LIRA-345 (S3) — Katsh settles by day: no Pay / Receive tab either.
    await screen.findByTestId("supplier-open-transactions");
    expect(screen.queryByText("Pay / Receive")).toBeNull();
    expect(screen.queryByRole("button", { name: "Settle" })).toBeNull();
    expect(screen.queryByText("Commission Settlement")).toBeNull();
    // Recording a supplier payment is admin-only, so the form is not opened
    // for staff by default.
    expect(screen.queryByTestId("settle-modal")).toBeNull();

    const dialog = await openSupplierTable("transactions");
    expect(
      await within(dialog).findByTestId("supplier-txn-row-801"),
    ).toBeInTheDocument();
  });
});

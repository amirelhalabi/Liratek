/** @jest-environment jsdom */

/**
 * LIRA-345 (owner decisions S1/S3, 2026-10-26) — on the Suppliers page,
 * every supplier on the day calendar (`settlesByDay`) settles through
 * Settle Account and has no Pay / Receive tab:
 *   - Katsh: Settle Account opens the calendar; its bills keep the
 *     "Settle" tick list (bills only);
 *   - a product supplier: Settle Account; Purchases stays, Pay / Receive goes;
 *   - Loto stays as it is (Pay / Receive, no Settle Account).
 *
 * Renders the REAL page; `useApi` is ONE stable object (rule 25).
 *
 * RULE 17 — written before the page used `settlesByDay`; the first run's
 * failures are recorded in the LIRA-345 hand-off report.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Suppliers from "../index";
import { queueRow } from "@/features/suppliers/testing/accountSettleFixtures";

const mockGetSuppliers = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();

const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: jest.fn().mockResolvedValue([]),
  getSupplierLedger: jest.fn().mockResolvedValue([]),
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: jest.fn().mockResolvedValue([]),
  getUnsettledTransactions: mockGetUnsettledTransactions,
  settleTransactions: jest.fn(),
  recordSupplierCashflow: jest.fn(),
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn().mockResolvedValue([]),
  createSupplierPurchase: jest.fn(),
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
  getSupplierAccountLedger: jest.fn().mockResolvedValue([]),
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountTransactions: jest.fn().mockResolvedValue([]),
  getSupplierAccountExpectedStatement: jest.fn().mockResolvedValue(null),
  getSupplierAccountMonthRows: jest.fn(async () => []),
  getSupplierAccountDayDetail: jest.fn(async () => []),
  getSupplierOpenRecordedDebts: jest.fn().mockResolvedValue([]),
  settleSupplierAccount: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "u", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
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

const BASE = {
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  is_system: 1,
  created_at: "2026-09-01T00:00:00Z",
  account_supplier_id: null,
};
const KATSH = { ...BASE, id: 4, name: "Katsh", provider: "Katsh" };
const LOTO = { ...BASE, id: 5, name: "Loto Liban", provider: "LOTO" };
const ACME = {
  ...BASE,
  id: 9,
  name: "Acme Phones",
  provider: null,
  is_system: 0,
};

const BILL = {
  id: 801,
  amount: 50,
  currency: "USD",
  commission: 0,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: null,
  is_settled: 0,
  is_refunded: 0,
  service_type: "BILL" as const,
  commission_model: 1,
  cost: 0,
  supplier_owed: 0,
  created_at: "2026-10-03T10:00:00Z",
};
const SALE = {
  ...BILL,
  id: 802,
  service_type: "SEND" as const,
  supplier_owed: 9,
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

describe("Suppliers page — settle by day for suppliers outside the OMT account (LIRA-345)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([KATSH, LOTO, ACME]);
    mockGetUnsettledTransactions.mockResolvedValue([BILL, SALE]);
    mockGetSupplierAccountUnsettled.mockResolvedValue([]);
  });

  it("Katsh: Settle Account opens the calendar sheet; no Pay / Receive; the tick list shows bills only", async () => {
    // An old Pay / Receive payment: a Katsh credit on the account.
    mockGetSupplierAccountUnsettled.mockResolvedValue([
      queueRow({
        kind: "LEDGER",
        id: 900,
        supplier_id: 4,
        source_provider: "Katsh",
        source_name: "Katsh",
        created_at: "2026-10-01 09:00:00",
        amount_usd: -40,
        entry_type: "PAYMENT",
        service_type: null,
        omt_service_type: null,
        commission_model: null,
        row_scope: "ACCOUNT",
      }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-Katsh"));

    expect(
      await screen.findByText("Commission Settlement"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pay / Receive")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByText(
          "Bills only. Top-ups and transfers are settled with Settle Account.",
        ),
      ).toBeInTheDocument(),
    );
    // The bill is on the tick list; the sale is not (it is a calendar row).
    expect(await screen.findByTestId("settle-row-801")).toBeInTheDocument();
    expect(screen.queryByTestId("settle-row-802")).toBeNull();

    fireEvent.click(screen.getByTestId("supplier-settle-by-day-button"));
    expect(await screen.findByText("Settle Katsh account")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockGetSupplierAccountUnsettled).toHaveBeenCalledWith(4),
    );
    // Katsh does not settle by OMT statement type.
    expect(screen.queryByTestId("supplier-account-settle-covered")).toBeNull();
    // Nor is a Katsh credit removable as "OMT credit not accepted".
    expect(screen.queryByText(/Remove credit/)).toBeNull();
  });

  // Owner request 2026-10-27: with Pay / Receive gone, Purchases would be
  // the only tab, so the tab strip is not shown; the purchase history shows
  // straight under the header. Updated before the change; the first run
  // failed on the strip's "supplier-tab-items" button still being there.
  it("a product supplier: purchase history with no one-tab strip, Pay / Receive goes, Settle Account is offered", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-category-products"));
    fireEvent.click(await screen.findByTestId("supplier-tile-9"));

    expect(await screen.findByText("Purchase History")).toBeInTheDocument();
    expect(screen.queryByTestId("supplier-tab-items")).toBeNull();
    expect(screen.queryByText("Pay / Receive")).toBeNull();
    fireEvent.click(screen.getByTestId("supplier-settle-by-day-button"));
    const title = await screen.findByText("Settle Acme Phones account");
    expect(title).toBeInTheDocument();
  });

  // LIRA-351 (owner decisions 2026-10-29): Loto settles on the calendar —
  // rule 24, this case used to assert the opposite.
  it("Loto gets the Settle Account button, no Pay / Receive and no Settle tick list", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-LOTO"));
    expect(
      await screen.findByTestId("supplier-settle-by-day-button"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pay / Receive")).toBeNull();
    expect(screen.queryByTestId("supplier-tab-settle")).toBeNull();
    // Its always-empty commission tick list is gone too (no bills).
    expect(screen.queryByText("Commission Settlement")).toBeNull();
    expect(
      within(document.body).getAllByText("Loto Liban").length,
    ).toBeGreaterThan(0);
  });
});

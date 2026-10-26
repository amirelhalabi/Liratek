/** @jest-environment jsdom */

/**
 * LIRA-322 — the Suppliers page for the OMT account.
 *
 * US4 (T042): for the OMT counter, OMT App and iPick, Settle Account is the
 * one way to pay OMT — no "Pay / Receive" tab and no "Commission
 * Settlement" tick list; the panel opens on the Transactions history. A
 * supplier outside the account (Katsh) keeps both.
 *
 * US2 (T030): the history labels come from the settlements — a part-paid
 * transfer reads "Partial · $47.00" (its own currency), and "Outstanding"
 * shows both currencies for an account member.
 *
 * Renders the REAL page; `useApi` is ONE stable object (rule 25).
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
import { openSupplierTable } from "@/features/suppliers/testing/supplierTableModals";

const mockGetSuppliers = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetSupplierAccountBalances = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
// LIRA-343 T033a — the account parent's Transactions window reads every
// member's rows through this (not getAllSupplierTransactions("OMT")).
const mockGetSupplierAccountTransactions = jest.fn();

const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: jest.fn().mockResolvedValue([]),
  getSupplierLedger: jest.fn().mockResolvedValue([]),
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: mockGetAllSupplierTransactions,
  getUnsettledTransactions: jest.fn().mockResolvedValue([]),
  settleTransactions: jest.fn(),
  recordSupplierCashflow: jest.fn(),
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn().mockResolvedValue([]),
  createSupplierPurchase: jest.fn(),
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: mockGetSupplierAccountBalances,
  getSupplierAccountLedger: jest.fn().mockResolvedValue([]),
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountTransactions: mockGetSupplierAccountTransactions,
  getSupplierAccountExpectedStatement: jest.fn().mockResolvedValue(null),
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

const BASE_SUPPLIER = {
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  is_system: 1,
  created_at: "2026-09-01T00:00:00Z",
};
const OMT = {
  ...BASE_SUPPLIER,
  id: 1,
  name: "OMT",
  provider: "OMT",
  account_supplier_id: null,
};
const OMT_APP = {
  ...BASE_SUPPLIER,
  id: 2,
  name: "OMT App",
  provider: "OMT_APP",
  account_supplier_id: 1,
};
const IPICK = {
  ...BASE_SUPPLIER,
  id: 3,
  name: "iPick",
  provider: "iPick",
  account_supplier_id: 1,
};
const KATSH = {
  ...BASE_SUPPLIER,
  id: 4,
  name: "Katsh",
  provider: "Katsh",
  account_supplier_id: null,
};

const ACCOUNT = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 54,
  total_lbp: 800000,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 54,
      total_lbp: 800000,
      is_parent: true,
    },
    {
      supplier_id: 2,
      name: "OMT App",
      provider: "OMT_APP",
      drawer_name: "OMT_App",
      total_usd: 0,
      total_lbp: 0,
      is_parent: false,
    },
    {
      supplier_id: 3,
      name: "iPick",
      provider: "iPick",
      drawer_name: "iPick",
      total_usd: 0,
      total_lbp: 0,
      is_parent: false,
    },
  ],
};

const TXN = {
  commission: 0,
  omt_fee: null,
  omt_service_type: "INTRA",
  settlement_id: null,
  is_settled: 0,
  is_refunded: 0,
  service_type: "SEND" as const,
};
/** $101 transfer part-paid by $47 (coverage). */
const USD_PARTIAL = {
  ...TXN,
  id: 701,
  amount: 101,
  currency: "USD",
  cost: 101,
  supplier_owed: 101,
  fifo_status: "partial" as const,
  fifo_paid_usd: 47,
  fifo_paid_lbp: 0,
  created_at: "2026-10-01T10:00:00Z",
};
/** 900,000 LBP transfer part-paid by 100,000 LBP. */
const LBP_PARTIAL = {
  ...TXN,
  id: 702,
  amount: 900000,
  currency: "LBP",
  cost: 900000,
  supplier_owed: 900000,
  fifo_status: "partial" as const,
  fifo_paid_usd: 0,
  fifo_paid_lbp: 100000,
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

function expectAccountMemberPanel() {
  expect(screen.queryByText("Pay / Receive")).toBeNull();
  expect(screen.queryByText("Commission Settlement")).toBeNull();
}

describe("Suppliers page — OMT account members pay only through Settle Account (LIRA-322 US4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT, OMT_APP, IPICK, KATSH]);
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT]);
    mockGetSupplierAccountUnsettled.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [USD_PARTIAL, LBP_PARTIAL] : []),
    );
    mockGetSupplierAccountTransactions.mockResolvedValue([
      USD_PARTIAL,
      LBP_PARTIAL,
    ]);
  });

  it("the OMT counter (account parent): no Pay / Receive, no Commission Settlement, history shown; Settle Account on the card", async () => {
    renderPage();
    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-tile-OMT"));

    await openSupplierTable("transactions");
    await screen.findByTestId("supplier-txn-row-701");
    expectAccountMemberPanel();
    expect(
      within(card).getByTestId("supplier-account-settle-button"),
    ).toBeInTheDocument();
  });

  it.each([
    ["OMT App", "OMT_APP"],
    ["iPick", "iPick"],
  ])(
    "%s (account child): no Pay / Receive and no Commission Settlement",
    async (_name, provider) => {
      renderPage();
      const card = await screen.findByTestId("supplier-account-card-OMT");
      fireEvent.click(
        within(card).getByTestId(`supplier-account-subrow-${provider}`),
      );

      await waitFor(() =>
        expect(mockGetAllSupplierTransactions).toHaveBeenCalledWith(provider),
      );
      expectAccountMemberPanel();
      expect(
        within(card).getByTestId("supplier-account-settle-button"),
      ).toBeInTheDocument();
    },
  );

  // LIRA-345 (owner S1/S3, 2026-10-26) — Katsh now settles its top-ups on
  // the day calendar too (no Pay / Receive); its bills keep the tick list.
  it("Katsh (outside any account) keeps Commission Settlement for its bills, without Pay / Receive", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-Katsh"));

    expect(
      await screen.findByText("Commission Settlement"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pay / Receive")).toBeNull();
  });
});

describe("Suppliers page — coverage labels for an account member (LIRA-322 US2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT, OMT_APP, IPICK, KATSH]);
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT]);
    mockGetSupplierAccountUnsettled.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [USD_PARTIAL, LBP_PARTIAL] : []),
    );
    mockGetSupplierAccountTransactions.mockResolvedValue([
      USD_PARTIAL,
      LBP_PARTIAL,
    ]);
  });

  it("a part-paid transfer reads 'Partial · <paid>' in its own currency", async () => {
    renderPage();
    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-tile-OMT"));

    await openSupplierTable("transactions");
    const usdRow = await screen.findByTestId("supplier-txn-row-701");
    expect(within(usdRow).getByText("Partial · $47.00")).toBeInTheDocument();
    const lbpRow = screen.getByTestId("supplier-txn-row-702");
    expect(
      within(lbpRow).getByText("Partial · 100,000 LBP"),
    ).toBeInTheDocument();
  });

  it("Outstanding shows both currencies", async () => {
    renderPage();
    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-tile-OMT"));

    await openSupplierTable("transactions");
    await screen.findByTestId("supplier-txn-row-701");
    expect(
      screen.getByText("Outstanding: $54.00 · 800,000 LBP"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2\s*partial/)).toBeInTheDocument();
  });
});

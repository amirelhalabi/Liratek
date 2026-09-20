/** @jest-environment jsdom */
/**
 * Owner-reported bug (2026-09-20, desktop e2e): the Suppliers page's Refresh
 * button does not refresh the OMT open-credit account card (LIRA-188) — the
 * headline balance, per-member sub-rows, merged account ledger and merged
 * unsettled queue all silently keep showing stale data after a click.
 *
 * This is the SAME mistake as `Suppliers.refreshUnsettled.test.tsx`
 * (`unsettledQuery` added, never wired into Refresh) recurring a second
 * time: `accountBalancesQuery`/`accountLedgerQuery` (page-level) and the
 * account-unsettled read every `SupplierAccountCard` owns were added by
 * LIRA-188 and never taught to the Refresh handler either.
 *
 * Rule 17 (failing-first): confirmed against the pre-fix Refresh handler
 * (`onClick` missing the `refreshAccountQueries()` call added by this fix) —
 * this test failed with:
 *
 *   expect(received).toBeGreaterThan(expected)
 *   Expected: > 1
 *   Received:   1
 *
 * for `getSupplierAccountBalances`, `getSupplierAccountLedger` AND
 * `getSupplierAccountUnsettled` — none of the three were ever called again
 * after the initial mount fetch, no matter how many times Refresh was
 * clicked. See the task report for the full pre-fix run output.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Suppliers from "../index";

const mockGetSuppliers = jest.fn();
const mockGetSupplierBalances = jest.fn();
const mockGetSupplierProductBalances = jest.fn();
const mockGetSupplierLedger = jest.fn();
const mockGetSupplierProductItems = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockGetSupplierAccountBalances = jest.fn();
const mockGetSupplierAccountLedger = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getSuppliers: mockGetSuppliers,
      getSupplierBalances: mockGetSupplierBalances,
      getSupplierProductBalances: mockGetSupplierProductBalances,
      getSupplierLedger: mockGetSupplierLedger,
      getSupplierProductItems: mockGetSupplierProductItems,
      getAllSupplierTransactions: mockGetAllSupplierTransactions,
      getUnsettledTransactions: mockGetUnsettledTransactions,
      settleTransactions: jest.fn(),
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
      getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
      getSupplierAccountBalances: mockGetSupplierAccountBalances,
      getSupplierAccountLedger: mockGetSupplierAccountLedger,
      getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
    }),
    appEvents: { emit: () => undefined },
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

// Same shapes as Suppliers.accountRollup.test.tsx — an account parent (OMT)
// with two children, so `accountLedgerQuery`/the card's own unsettled read
// both actually go `enabled: true`.
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
  created_at: "2026-09-01T00:00:00Z",
  account_supplier_id: null,
};
const OMT_APP_SUPPLIER = {
  ...OMT_SUPPLIER,
  id: 2,
  name: "OMT App",
  provider: "OMT_APP",
  account_supplier_id: 1,
};

const ACCOUNT_BALANCE = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 1250,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 1050,
      total_lbp: 0,
      is_parent: true,
    },
    {
      supplier_id: 2,
      name: "OMT App",
      provider: "OMT_APP",
      drawer_name: "OMT_App",
      total_usd: 200,
      total_lbp: 0,
      is_parent: false,
    },
  ],
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

describe("Suppliers page — Refresh re-fetches the OMT account queries (LIRA-188 follow-up)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER, OMT_APP_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT_BALANCE]);
    mockGetSupplierAccountLedger.mockResolvedValue([]);
    mockGetSupplierAccountUnsettled.mockResolvedValue([]);
  });

  it("clicking Refresh calls getSupplierAccountBalances, getSupplierAccountLedger AND getSupplierAccountUnsettled again", async () => {
    renderPage();

    // Initial mount fetch of the account rollup (always-on read) and the
    // account card's own unsettled read (SupplierAccountCard, always
    // rendered once the card exists).
    await screen.findByTestId("supplier-account-card-OMT");
    await waitFor(() =>
      expect(mockGetSupplierAccountBalances).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(mockGetSupplierAccountUnsettled).toHaveBeenCalledWith(1),
    );

    // Select the account parent so `accountLedgerQuery` (page-level, gated
    // on `isSelectedAccountParent`) goes `enabled: true` and fetches too.
    fireEvent.click(screen.getByTestId("supplier-tile-OMT"));
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenCalledWith(1, 200),
    );

    const balancesCallsBefore =
      mockGetSupplierAccountBalances.mock.calls.length;
    const ledgerCallsBefore = mockGetSupplierAccountLedger.mock.calls.length;
    const unsettledCallsBefore =
      mockGetSupplierAccountUnsettled.mock.calls.length;

    fireEvent.click(await screen.findByText("Refresh"));

    await waitFor(() => {
      expect(
        mockGetSupplierAccountBalances.mock.calls.length,
      ).toBeGreaterThan(balancesCallsBefore);
      expect(mockGetSupplierAccountLedger.mock.calls.length).toBeGreaterThan(
        ledgerCallsBefore,
      );
      expect(
        mockGetSupplierAccountUnsettled.mock.calls.length,
      ).toBeGreaterThan(unsettledCallsBefore);
    });
  });
});

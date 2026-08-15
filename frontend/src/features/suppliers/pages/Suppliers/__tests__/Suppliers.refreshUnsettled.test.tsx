/** @jest-environment jsdom */
/**
 * Owner-reported bug (2026-08-15): the Suppliers -> Settle tab can show a
 * stale unsettled-bill list for up to 30s (the app-wide `staleTime` in
 * frontend/src/app/App.tsx) after a new Katsh/iPick bill is created, and the
 * page's own Refresh button did nothing about it.
 *
 * `useUnsettledTransactionsQuery` (`frontend/src/features/suppliers/hooks/
 * useSuppliers.ts`, key `SUPPLIER_KEYS.unsettled(provider)`) sets no
 * per-query `staleTime`, so it inherits the 30s default. The Refresh
 * button's onClick (`Suppliers/index.tsx`) refetched every other query on
 * the page (`suppliersQuery`, `balancesQuery`, `productBalancesQuery`,
 * `ledgerQuery`, `allTxnsQuery`) but never `unsettledQuery` — the ONE list
 * an operator is looking at right after creating a bill.
 *
 * Rule 17 (failing-first): confirmed against the pre-fix Refresh handler —
 * this test failed with:
 *
 *   Expected number of calls to be greater than 1, received 1
 *
 * i.e. `getUnsettledTransactions` was called exactly once (the initial
 * mount fetch) and never again after clicking Refresh. See the task report
 * for the full pre-fix run output.
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
      supplierWriteOff: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
    }),
    // Wrapped in a closure — jest.mock factories are hoisted above this
    // file's `const` declarations (same reason as the sibling test file).
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

// Same shape as Suppliers.settleNetPayCurrency.test.tsx's KATSH_SUPPLIER —
// a non-product, provider-bearing supplier, the only shape `unsettledQuery`
// is ever `enabled` for.
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

describe("Suppliers page — Refresh re-fetches the unsettled-bill list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetSupplierProductItems.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
  });

  it("clicking Refresh calls getUnsettledTransactions again for the selected provider", async () => {
    renderPage();

    fireEvent.click((await screen.findAllByText("Katsh"))[0]);

    // Initial mount fetch for the selected (non-product) supplier's provider.
    await waitFor(() =>
      expect(mockGetUnsettledTransactions).toHaveBeenCalledWith("Katsh"),
    );
    const callsBeforeRefresh = mockGetUnsettledTransactions.mock.calls.length;

    fireEvent.click(await screen.findByText("Refresh"));

    await waitFor(() =>
      expect(mockGetUnsettledTransactions.mock.calls.length).toBeGreaterThan(
        callsBeforeRefresh,
      ),
    );
  });
});

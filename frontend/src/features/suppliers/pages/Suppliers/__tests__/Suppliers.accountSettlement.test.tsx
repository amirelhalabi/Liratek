/** @jest-environment jsdom */

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, wave 2, lane W6) — the
 * account-wide settle BUTTON's placement and gate on the Suppliers page
 * itself (the sheet's own internals are covered by
 * `components/__tests__/AccountSettleSheet.test.tsx`).
 *
 * CONTRACT_W2.md §3 W6: "On the OMT account card, the settle button opens
 * an account settlement sheet" — both e2e lanes (W7 page-level lookup, W8
 * `card.getByTestId(...)` SCOPED to the account card) depend on this being
 * true, so it is asserted here at the interaction layer rather than only
 * being implied by where the JSX happens to sit.
 *
 * Renders the REAL Suppliers page + REAL `SupplierAccountCard`/
 * `AccountSettleSheet` (jest.config.ts maps "@liratek/ui" to
 * packages/ui/src — only `useApi` is overridden, same convention as
 * `Suppliers.accountRollup.test.tsx`).
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Suppliers from "../index";

const mockGetSuppliers = jest.fn();
const mockGetSupplierBalances = jest.fn();
const mockGetSupplierProductBalances = jest.fn();
const mockGetSupplierLedger = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockSettleTransactions = jest.fn();
const mockGetSupplierAccountBalances = jest.fn();
const mockGetSupplierAccountLedger = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockSettleSupplierAccount = jest.fn();

let currentRole: "admin" | "staff" = "admin";

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getSuppliers: mockGetSuppliers,
      getSupplierBalances: mockGetSupplierBalances,
      getSupplierProductBalances: mockGetSupplierProductBalances,
      getSupplierLedger: mockGetSupplierLedger,
      getSupplierProductItems: jest.fn(),
      getAllSupplierTransactions: mockGetAllSupplierTransactions,
      getUnsettledTransactions: mockGetUnsettledTransactions,
      settleTransactions: mockSettleTransactions,
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
      getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
      getSupplierAccountBalances: mockGetSupplierAccountBalances,
      getSupplierAccountLedger: mockGetSupplierAccountLedger,
      getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
      settleSupplierAccount: mockSettleSupplierAccount,
    }),
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "u", get role() { return currentRole; } } }),
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
const IPICK_SUPPLIER = {
  ...OMT_SUPPLIER,
  id: 3,
  name: "iPick",
  provider: "iPick",
  account_supplier_id: 1,
};

const ACCOUNT_BALANCE = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 214,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 0,
      total_lbp: 0,
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
      total_usd: 214,
      total_lbp: 0,
      is_parent: false,
    },
  ],
};

const ACCOUNT_UNSETTLED = [
  {
    kind: "LEDGER" as const,
    id: 501,
    supplier_id: 3,
    source_provider: "iPick",
    source_name: "iPick",
    created_at: "2026-09-01T00:00:00Z",
    amount_usd: 214,
    amount_lbp: 0,
    entry_type: "TOP_UP",
    service_type: null,
  },
];

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

describe("Suppliers page — OMT account settle button placement (LIRA-189)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentRole = "admin";
    mockGetSuppliers.mockResolvedValue([
      OMT_SUPPLIER,
      OMT_APP_SUPPLIER,
      IPICK_SUPPLIER,
    ]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT_BALANCE]);
    mockGetSupplierAccountUnsettled.mockResolvedValue(ACCOUNT_UNSETTLED);
    mockGetSupplierAccountLedger.mockResolvedValue([]);
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
  });

  it("renders the settle button INSIDE the account card, not the per-supplier detail panel", async () => {
    renderPage();

    const card = await screen.findByTestId("supplier-account-card-OMT");
    const button = within(card).getByTestId("supplier-account-settle-button");
    expect(button).toBeInTheDocument();
    // Exactly one instance page-wide (both e2e lanes' `getByTestId` calls —
    // one page-scoped, one card-scoped — require a single match).
    expect(screen.getAllByTestId("supplier-account-settle-button")).toHaveLength(1);
  });

  it("clicking the card's settle button opens the sheet directly, without first requiring the account to be the selected supplier", async () => {
    renderPage();

    const card = await screen.findByTestId("supplier-account-card-OMT");
    // Never select the account first (lira-web-035's own UI pass does the
    // same — it clicks the card's settle button with nothing selected yet).
    fireEvent.click(within(card).getByTestId("supplier-account-settle-button"));

    const sheet = await screen.findByTestId("supplier-account-settle-sheet");
    expect(sheet).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetSupplierAccountUnsettled).toHaveBeenCalledWith(1);
    });
  });

  it("is hidden for a non-admin (staff) user, same gate as the settle/cashflow mutations it calls", async () => {
    currentRole = "staff";
    renderPage();

    await screen.findByTestId("supplier-account-card-OMT");
    expect(screen.queryByTestId("supplier-account-settle-button")).toBeNull();
  });
});

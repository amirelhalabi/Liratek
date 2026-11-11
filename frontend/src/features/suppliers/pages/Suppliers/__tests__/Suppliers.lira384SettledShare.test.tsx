/** @jest-environment jsdom */
/**
 * LIRA-384 — the Suppliers Transactions tab shows a settled transfer's share
 * of the settlement commission (what Profits counts), never the booking
 * estimate; the estimate (with its "est." badge) only while unsettled. Same
 * derivation as OMT/Whish History (`@/shared/utils/historyCommission`).
 *
 * Rule 17: run red before the fix (see report).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Suppliers from "../index";
import { openSupplierTable } from "@/features/suppliers/testing/supplierTableModals";

const mockGetSuppliers = jest.fn();
const mockGetSupplierBalances = jest.fn();
const mockGetSupplierProductBalances = jest.fn();
const mockGetSupplierLedger = jest.fn();
const mockGetSupplierProductItems = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockSettleTransactions = jest.fn();
const mockAppEventsEmit = jest.fn();

const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the page now always
  // fetches this too; none of this file's cases exercise an account
  // parent, so a static empty array (no account on this tenant) keeps
  // every existing assertion byte-for-byte unaffected.
  getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: mockGetSupplierProductBalances,
  // The page always mounts useProductStockValueQuery; without this key its
  // queryFn threw "is not a function" on every render of every case.
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getSupplierLedger: mockGetSupplierLedger,
  getSupplierProductItems: mockGetSupplierProductItems,
  getAllSupplierTransactions: mockGetAllSupplierTransactions,
  getUnsettledTransactions: mockGetUnsettledTransactions,
  settleTransactions: mockSettleTransactions,
  recordSupplierCashflow: jest.fn(),
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn(),
  createSupplierPurchase: jest.fn(),
};

// Same mock pattern as Suppliers.commissionAtSettlement.test.tsx — spread the
// REAL @liratek/ui module (jest.requireActual) so the shared balance-colour
// helpers (BALANCE_EPS/balanceBucket/balanceTextColor) this page also imports
// stay real; only useApi/appEvents/CounterpartySettleModal/PageHeader are
// stubbed.
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    // Rule 25 — return ONE module-level object, never a fresh literal per
    // call: production's useApi() is identity-stable, so the mock must be too.
    useApi: () => mockApi,
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
    CounterpartySettleModal: ({
      title,
      onConfirm,
      confirmLabel,
      beforeContent,
      children,
    }: {
      title?: string;
      onConfirm: () => void;
      confirmLabel: string;
      beforeContent?: React.ReactNode;
      children?: React.ReactNode;
    }) => (
      <div data-testid="settle-modal">
        <h2>{title}</h2>
        {beforeContent}
        {children}
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ),
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
  provider: "Alfa",
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
  commission_entry_mode: "RATE" as const,
  commission_rate: 20000,
  commission_rate_currency: "LBP" as const,
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

// CI run 38142644755 timed out here once, on this file's FIRST case, with the
// supplier list still empty ("No suppliers found."). Not reproduced locally
// (2 full coverage runs, a cold-cache 3-worker run under CPU stress, 5+
// file runs). Measured locally: the first case in the file takes ~90-190 ms
// to render and ~60-90 ms more for the list to appear; later cases take
// 2-4 ms + 6-10 ms. No render loop (useApi call count settles). So the
// default 1000 ms leaves little room for that one-off warm-up on a slower
// shared runner. Widened for this list wait only.
async function selectKatsh() {
  fireEvent.click(
    (await screen.findAllByText("Katsh", {}, { timeout: 5000 }))[0],
  );
}

const row = (o: Record<string, unknown>) => ({
  service_type: "BILL" as const,
  currency: "LBP",
  amount: 300000,
  commission: 5000,
  commission_model: 1,
  cost: 0,
  omt_fee: null,
  omt_service_type: null,
  supplier_owed: 0,
  fifo_paid_usd: 0,
  created_at: "2026-08-20T09:00:00Z",
  ...o,
});

async function commissionCellOf(r: Record<string, unknown>) {
  mockGetAllSupplierTransactions.mockResolvedValue([r]);
  renderPage();
  await selectKatsh();
  await openSupplierTable("transactions");
  const typeEl = await screen.findByText("BILL");
  const line = typeEl.closest(".items-center") as HTMLElement;
  return (
    line.querySelector('[data-testid="supplier-txn-commission"]') ??
    (line.querySelector(".text-emerald-400") as HTMLElement)
  );
}

describe("Suppliers Transactions tab — settled share vs estimate (LIRA-384)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("settled row: its settled share, not the estimate, no badge", async () => {
    const cell = await commissionCellOf(
      row({
        id: 701,
        settlement_id: 3,
        is_settled: 1,
        fifo_status: "paid",
        settled_commission_usd: 0,
        settled_commission_lbp: 7000,
      }),
    );
    expect(cell.textContent).toContain("7,000 LBP");
    expect(cell.textContent).not.toContain("5,000");
    expect(cell.textContent).not.toMatch(/est\./i);
  });

  it("settled row with no allocation: no share, never the estimate", async () => {
    const cell = await commissionCellOf(
      row({
        id: 702,
        settlement_id: 3,
        is_settled: 1,
        fifo_status: "paid",
        settled_commission_usd: null,
        settled_commission_lbp: null,
      }),
    );
    expect(cell.textContent).toBe("—");
  });

  it("unsettled row: the estimate with its badge", async () => {
    const cell = await commissionCellOf(
      row({
        id: 703,
        settlement_id: null,
        is_settled: 0,
        fifo_status: "unpaid",
      }),
    );
    expect(cell.textContent).toContain("5,000 LBP");
    expect(cell.textContent).toMatch(/est\./i);
  });
});

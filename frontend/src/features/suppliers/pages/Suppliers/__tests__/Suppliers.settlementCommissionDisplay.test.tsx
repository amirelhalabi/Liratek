/** @jest-environment jsdom */
/**
 * Katsh/iPick bills-only settlement — display-only fix.
 *
 * When a bills-only settlement is confirmed, the commission (e.g. 20,000 LBP)
 * is credited to the provider drawer via `_bookBillsCommissionDrawerTopUp`
 * and recorded in two AUDIT tables (`supplier_settlements`,
 * `settlement_commission_allocations`), but two UI tables on this page used
 * to show "—" instead of that money:
 *
 *   1. The Payments (supplier ledger) table — the SETTLEMENT row is
 *      legitimately amount_usd=0/amount_lbp=0 (nothing was paid out through
 *      it — the commission went straight into the provider's own drawer),
 *      so both currency cells read "—".
 *   2. The Transactions history table — a settled BILL row's OWN
 *      `financial_services.commission` column is 0 (commission is entered
 *      AT settlement, not creation), so the Commission cell reads "—".
 *
 * `SupplierRepository.getSupplierLedger` now LEFT JOINs `supplier_settlements`
 * (settlement_commission_usd/lbp) and `FinancialServiceRepository
 * .getAllByProvider` now LEFT JOINs `settlement_commission_allocations`
 * (settled_commission_usd/lbp) to surface this money for DISPLAY ONLY — no
 * ledger amount, no balance, no drawer write changes (HARD CONSTRAINT: this
 * is a read/display fix; lira-137's e2e guard asserts the ledger balance
 * delta stays 0 for a bills-only settlement).
 *
 * Rule 17 (failing-first): every "positive" case below fails against the
 * pre-fix `index.tsx` (the join fields are ignored, so the cell always
 * renders "—") — see the task report for the captured failure output before
 * `index.tsx` was touched. The "negative" cases prove the substitution is
 * narrowly gated: a row with a REAL amount, or an unsettled row with no
 * allocation, must render exactly as before.
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

// Same mock pattern as Suppliers.commissionAtSettlement.test.tsx — spread the
// REAL @liratek/ui module (jest.requireActual) so the shared balance-colour
// helpers (BALANCE_EPS/balanceBucket/balanceTextColor) this page also imports
// stay real; only useApi/appEvents/CounterpartySettleModal/PageHeader are
// stubbed.
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
      settleTransactions: mockSettleTransactions,
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
      supplierWriteOff: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
    }),
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
  provider: "Katsh",
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
  commission_entry_mode: "RATE" as const,
  commission_rate: 20000,
  commission_rate_currency: "LBP" as const,
};

// Case 1 — bills-only settlement's SETTLEMENT row: contractually 0/0, the
// batch commission lives in the joined settlement_commission_usd/lbp fields.
const SETTLEMENT_ZERO_ROW = {
  id: 501,
  supplier_id: 1,
  entry_type: "SETTLEMENT" as const,
  amount_usd: 0,
  amount_lbp: 0,
  note: "Settlement: 1 txns",
  created_by: 1,
  transaction_id: 900,
  is_refunded: 0,
  refunded_at: null,
  settlement_commission_usd: 0,
  settlement_commission_lbp: 20000,
  created_at: "2026-08-20T10:00:00Z",
};

// Case 2 — a settlement that DID pay real money (amount_usd nonzero): the
// commission field must NOT override the real amount.
const SETTLEMENT_REAL_AMOUNT_ROW = {
  id: 502,
  supplier_id: 1,
  entry_type: "SETTLEMENT" as const,
  amount_usd: -95,
  amount_lbp: 0,
  note: "Settlement: 3 txns",
  created_by: 1,
  transaction_id: 901,
  is_refunded: 0,
  refunded_at: null,
  settlement_commission_usd: 5,
  settlement_commission_lbp: 0,
  created_at: "2026-08-20T11:00:00Z",
};

// Case 3 — a settled BILL row: own `commission` is 0 by design, the
// allocated share lives in settled_commission_usd/lbp.
const SETTLED_BILL_ROW = {
  id: 601,
  service_type: "BILL" as const,
  currency: "LBP",
  amount: 300000,
  commission: 0,
  cost: 0,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: 3,
  is_settled: 1,
  supplier_owed: 0,
  fifo_status: "paid" as const,
  fifo_paid_usd: 0,
  settled_commission_lbp: 20000,
  settled_commission_usd: 0,
  created_at: "2026-08-20T09:00:00Z",
};

// Case 4 — an UNSETTLED bill: no settlement_id, no allocation fields at all.
const UNSETTLED_BILL_ROW = {
  id: 602,
  service_type: "BILL" as const,
  currency: "LBP",
  amount: 300000,
  commission: 0,
  cost: 0,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: null,
  is_settled: 0,
  supplier_owed: 0,
  fifo_status: "unpaid" as const,
  fifo_paid_usd: 0,
  created_at: "2026-08-20T09:30:00Z",
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
  fireEvent.click((await screen.findAllByText("Katsh"))[0]);
}

describe("Suppliers page — bills-only settlement commission display (read-only enrichment)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("Payments table: a 0/0 SETTLEMENT row shows the settlement commission in the LBP cell, and '—' in the USD cell", async () => {
    mockGetSupplierLedger.mockResolvedValue([SETTLEMENT_ZERO_ROW]);

    renderPage();
    await selectKatsh();

    const noteEl = await screen.findByText("Settlement: 1 txns");
    const row = noteEl.closest(".items-center") as HTMLElement;
    expect(row).toBeTruthy();
    const cells = Array.from(row.children) as HTMLElement[];
    const usdCell = cells[1];
    const lbpCell = cells[2];

    expect(lbpCell.textContent).toBe("20,000");
    expect(usdCell.textContent).toBe("—");
  });

  it("Payments table: a SETTLEMENT row with a REAL amount still renders the ledger amount, not the commission", async () => {
    mockGetSupplierLedger.mockResolvedValue([SETTLEMENT_REAL_AMOUNT_ROW]);

    renderPage();
    await selectKatsh();

    const noteEl = await screen.findByText("Settlement: 3 txns");
    const row = noteEl.closest(".items-center") as HTMLElement;
    const cells = Array.from(row.children) as HTMLElement[];
    const usdCell = cells[1];
    const lbpCell = cells[2];

    expect(usdCell.textContent).toBe("-95.00");
    // amount_lbp is 0 on this row but the row is NOT the bills-only 0/0
    // shape (amount_usd is nonzero) — the commission substitution gate
    // requires BOTH currencies to be 0, so LBP must still read "—".
    expect(lbpCell.textContent).toBe("—");
  });

  it("Transactions table: a settled BILL row (commission=0) shows the allocated settlement commission", async () => {
    mockGetAllSupplierTransactions.mockResolvedValue([SETTLED_BILL_ROW]);

    renderPage();
    await selectKatsh();

    const typeEl = await screen.findByText("BILL");
    const row = typeEl.closest(".items-center") as HTMLElement;
    expect(row).toBeTruthy();
    expect(within(row).getByText("20,000 LBP")).toBeInTheDocument();
  });

  it("Transactions table: an UNSETTLED bill (no allocation) still shows '—' for Commission", async () => {
    mockGetAllSupplierTransactions.mockResolvedValue([UNSETTLED_BILL_ROW]);

    renderPage();
    await selectKatsh();

    const typeEl = await screen.findByText("BILL");
    const row = typeEl.closest(".items-center") as HTMLElement;
    expect(row).toBeTruthy();
    const commissionCell = row.querySelector(".text-emerald-400");
    expect(commissionCell?.textContent).toBe("—");
  });
});

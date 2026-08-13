/** @jest-environment jsdom */
/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 0+1 — Settlement UI.
 *
 * Proves `handleBatchSettle` (Suppliers/index.tsx) builds the right
 * `settleTransactions` payload for the two batch kinds the backend
 * distinguishes by `commission_model` (D2/D3/D4):
 *
 *   - NEW-MODEL batch (commission_model = 1, e.g. a Katsh BILL row): the
 *     commission is ENTERED in the Settle modal (D8) — the payload must carry
 *     the money-bearing `commission_usd`/`commission_lbp` PLUS the
 *     `entry_mode`/`commission_rate`/`commission_unit_count` audit snapshot.
 *   - LEGACY batch (commission_model = 0, a pre-cutover OMT SEND row): the
 *     payload must stay byte-for-byte what it was before this feature —
 *     informational `commission_usd` only, no D8 fields at all.
 *
 * Rule 17 (failing-first): reverting `handleBatchSettle`'s
 * `...(isNewModelBatch ? {...} : {...})` branch back to the old
 * unconditional `commission_usd: settleCommissionUsd, commission_lbp: 0`
 * shape (temporarily, to confirm red) makes the "NEW-MODEL" test below fail
 * — `payload.entry_mode`/`commission_rate`/`commission_unit_count` come back
 * `undefined` and `payload.commission_lbp` comes back `0` instead of the
 * entered 20000. Confirmed against that reverted code, then restored — see
 * the task report for the exact diff and failure output.
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

const mockGetSuppliers = jest.fn();
const mockGetSupplierBalances = jest.fn();
const mockGetSupplierProductBalances = jest.fn();
const mockGetSupplierLedger = jest.fn();
const mockGetSupplierProductItems = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockSettleTransactions = jest.fn();
const mockAppEventsEmit = jest.fn();

// Spread the REAL module first (`jest.requireActual`) — this page now also
// imports the shared, presentation-only balance colour helpers
// (`BALANCE_EPS`/`balanceBucket`/`balanceTextColor`, `@liratek/ui`, Balance
// Pages colour audit 2026-08-11), which a plain object-literal mock like the
// old one here would silently turn into `undefined` (a `TypeError` at
// render). Only the pieces below need stubbing — everything else stays real.
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
    // Wrapped in a closure — see Partners.addCreditLbp.test.tsx's comment on
    // why a direct `{ emit: mockAppEventsEmit }` property throws a TDZ error
    // (jest.mock factories are hoisted above this file's `const` declarations).
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
    // Minimal stand-in that renders beforeContent/children (the D8 entry-mode
    // UI lives in beforeContent) and exposes onConfirm — what's under test is
    // Suppliers/index.tsx's own payload-building code, not the shared modal
    // shell (covered elsewhere).
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

// LIRA-112 (D12): Katsh is the ONE bill provider that actually earns
// commission (20,000 LBP/bill, RATE mode) — iPick's supplier row is
// commission_eligible = 0 and never reaches the unsettled queue at all, so
// it can't be this fixture (this file mocks getUnsettledTransactions
// directly and never exercises the real eligibility gate — see
// FinancialServiceRepository.billsSettlement.test.ts's "LIRA-112" describe
// block for that backend-level proof).
const NEW_MODEL_SUPPLIER = {
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
  // D8 — pre-selects RATE mode with the supplier's saved per-bill rate.
  commission_entry_mode: "RATE" as const,
  commission_rate: 20000,
  // LIRA-112 (v151) — Katsh's rate is denominated in LBP, not USD.
  commission_rate_currency: "LBP" as const,
};

const LEGACY_SUPPLIER = {
  id: 2,
  name: "OMT",
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  provider: "OMT",
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
  commission_entry_mode: "LUMP" as const,
  commission_rate: null,
};

// commission_model = 1 (AT_SETTLEMENT) — born commission = 0, joins the
// unsettled queue via the BILL branch of PENDING_SETTLEMENT_SQL.
const BILL_ROW = {
  id: 101,
  service_type: "BILL" as const,
  amount: 500000,
  currency: "LBP",
  commission: 0,
  omt_fee: null,
  omt_service_type: null,
  client_name: null,
  supplier_owed: 0,
  commission_model: 1,
  created_at: "2026-08-08T10:00:00Z",
};

// commission_model = 0 (EMBEDDED legacy) — the pre-cutover OMT float model,
// commission > 0 is still the historical pending-settlement marker.
const LEGACY_ROW = {
  id: 201,
  service_type: "SEND" as const,
  amount: 100,
  currency: "USD",
  commission: 5,
  omt_fee: 2,
  omt_service_type: "OMT_TRANSFER",
  client_name: null,
  supplier_owed: 100,
  commission_model: 0,
  created_at: "2026-08-08T10:05:00Z",
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

describe("Suppliers page — commission-at-settlement Settle modal (Phase 0+1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([NEW_MODEL_SUPPLIER, LEGACY_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("NEW-MODEL batch (BILL row): sends money-bearing commission + the D8 entry_mode/rate/count snapshot", async () => {
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
    );

    renderPage();

    // "Katsh" also appears as the drawer badge next to the name — target
    // the supplier-list button specifically via getAllByText.
    fireEvent.click((await screen.findAllByText("Katsh"))[0]);

    // Wait for the pending-row list itself to render (not just the "select
    // all" checkbox, which is present from the first render, before
    // `unsettledTxns` has loaded — checking it too early would toggle a
    // stale, still-empty `selectableUnsettled` closure) — then check the
    // bill row's own checkbox.
    const billRow = (await screen.findByText("Bill")).closest("label")!;
    fireEvent.click(within(billRow).getByRole("checkbox"));

    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

    // D8 default: RATE mode pre-selected from the supplier's preference,
    // rate pre-filled from commission_rate, count pre-filled from the
    // selection size — confirm without touching any input.
    expect(await screen.findByDisplayValue("20000")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm Settlement"));

    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    const payload = mockSettleTransactions.mock.calls[0][0];
    expect(payload.financial_service_ids).toEqual([101]);
    // Bill principal never reaches the ledger (SUPPLIER_OWED_EXPR's BILL
    // branch is 0) — a bill-only batch settles for $0 cash.
    expect(payload.amount_usd).toBe(0);
    expect(payload.amount_lbp).toBe(0);
    // Money-bearing: 20000 (rate) × 1 (count), booked as LBP — LIRA-112:
    // sourced from the supplier's OWN stored commission_rate_currency, not
    // inferred from the batch containing a BILL row (see the dedicated
    // currency-source test below, which proves the two would disagree).
    expect(payload.commission_lbp).toBe(20000);
    expect(payload.commission_usd).toBe(0);
    expect(payload.entry_mode).toBe("RATE");
    expect(payload.commission_rate).toBe(20000);
    expect(payload.commission_unit_count).toBe(1);
  });

  // LIRA-112 — "commission_rate was specced in USD but Katsh's rate is
  // 20,000 LBP" (the ticket's own currency concern). Before this fix, the
  // RATE-mode currency toggle was pre-selected by INFERRING from the batch's
  // contents (`selectedUnsettled.some(t => t.service_type === "BILL") ?
  // "LBP" : "USD"`) rather than reading the supplier's own stored
  // `commission_rate_currency`. This test uses a RATE-mode supplier whose
  // stored currency is USD despite the batch being bill-only — the old
  // heuristic and the new stored-config read DISAGREE here, so this proves
  // which one actually wins.
  //
  // Rule 17 (failing-first): reverting `handleOpenSettleConfirm`'s
  // `setSettleRateCurrency` call to the old heuristic (dropping
  // `selectedSupplier?.commission_rate_currency ??`) makes this test fail —
  // `payload.commission_usd` comes back `0` and `payload.commission_lbp`
  // comes back `20000` (the OLD "any bill batch is LBP" behavior) instead of
  // the supplier's actual USD config. Confirmed against that reverted code,
  // then restored — see the task report for the exact failure output.
  it("RATE-mode currency comes from the supplier's OWN commission_rate_currency, not inferred from the batch containing a BILL row", async () => {
    const usdRateSupplier = {
      ...NEW_MODEL_SUPPLIER,
      id: 3,
      name: "SomeBillProvider",
      provider: "SomeBillProvider",
      commission_rate: 500,
      commission_rate_currency: "USD" as const,
    };
    mockGetSuppliers.mockResolvedValue([usdRateSupplier, LEGACY_SUPPLIER]);
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "SomeBillProvider" ? [BILL_ROW] : []),
    );

    renderPage();

    fireEvent.click((await screen.findAllByText("SomeBillProvider"))[0]);

    const billRow = (await screen.findByText("Bill")).closest("label")!;
    fireEvent.click(within(billRow).getByRole("checkbox"));

    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

    expect(await screen.findByDisplayValue("500")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm Settlement"));

    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    const payload = mockSettleTransactions.mock.calls[0][0];
    // 500 (rate) × 1 (count), booked as USD — the supplier's OWN config,
    // even though the batch is bill-only (which the old heuristic would
    // have read as LBP).
    expect(payload.commission_usd).toBe(500);
    expect(payload.commission_lbp).toBe(0);
  });

  it("LEGACY batch (OMT SEND row, commission_model=0): payload stays informational-commission-only, no D8 fields", async () => {
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
    );

    renderPage();

    fireEvent.click(await screen.findByText("OMT"));

    const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
      "label",
    )!;
    fireEvent.click(within(legacyRow).getByRole("checkbox"));

    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

    // Legacy UI: no entry-mode toggle — the derived-commission line is shown
    // instead (byte-for-byte the pre-existing display).
    expect(
      screen.queryByText("Lump sum") || screen.queryByText("Rate × count"),
    ).toBeNull();
    fireEvent.click(await screen.findByText("Confirm Settlement"));

    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    const payload = mockSettleTransactions.mock.calls[0][0];
    expect(payload.financial_service_ids).toEqual([201]);
    // Fee-only supplier_owed already nets the shop's cut — pay exactly that.
    expect(payload.amount_usd).toBe(100);
    expect(payload.amount_lbp).toBe(0);
    expect(payload.commission_usd).toBe(5);
    expect(payload.commission_lbp).toBe(0);
    expect(payload.entry_mode).toBeUndefined();
    expect(payload.commission_rate).toBeUndefined();
    expect(payload.commission_unit_count).toBeUndefined();
  });

  // Owner request (2026-08-13) #1/#2 — the settle list's section heading and
  // column headers. Scoped via `within(container)` because "Type"/"Date" are
  // ALSO column headers in the (always-rendered) Payments ledger history
  // table further down the same page — an unscoped `getByText` would throw
  // "multiple elements found".
  it("renders the 'Commission Settlement' heading (not the old 'Settle transactions —' label) with column headers matching the row's own cells", async () => {
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
    );

    renderPage();

    fireEvent.click((await screen.findAllByText("Katsh"))[0]);
    await screen.findByText("Bill");

    const heading = screen.getByText("Commission Settlement");
    expect(heading.tagName).toBe("H3");
    // The old combined label is gone; "select all" survives as its own,
    // simpler affordance.
    expect(screen.queryByText(/Settle transactions/)).toBeNull();
    expect(screen.getByText(/^Select all \(1\)$/)).toBeInTheDocument();

    const container = heading.parentElement!;
    expect(within(container).getByText("Type")).toBeInTheDocument();
    expect(within(container).getByText("Amount")).toBeInTheDocument();
    expect(within(container).getByText("Commission")).toBeInTheDocument();
    expect(within(container).getByText("Date")).toBeInTheDocument();
  });

  // Owner request (2026-08-13) #1 — "this table is used for different
  // companies, we should see the column names wherever its used": the
  // heading/headers are generic, not conditioned on the Katsh provider name
  // anywhere — proved here against the LEGACY (OMT) supplier, the OTHER
  // provider this same fixture set exercises.
  it("renders the SAME 'Commission Settlement' heading and column headers for a non-Katsh supplier (OMT)", async () => {
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
    );

    renderPage();

    fireEvent.click(await screen.findByText("OMT"));
    await screen.findByText("OMT_TRANSFER");

    const heading = screen.getByText("Commission Settlement");
    const container = heading.parentElement!;
    expect(within(container).getByText("Type")).toBeInTheDocument();
    expect(within(container).getByText("Amount")).toBeInTheDocument();
    expect(within(container).getByText("Commission")).toBeInTheDocument();
    expect(within(container).getByText("Date")).toBeInTheDocument();
  });

  // Owner follow-up (2026-08-13) #3 — the Top-up|Other payment toggle only
  // appears for a bills-only batch, defaulted to "Top-up".
  it("shows the Top-up|Other payment toggle, defaulted to Top-up, for a bills-only batch", async () => {
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
    );

    renderPage();

    fireEvent.click((await screen.findAllByText("Katsh"))[0]);
    const billRow = (await screen.findByText("Bill")).closest("label")!;
    fireEvent.click(within(billRow).getByRole("checkbox"));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

    const topUpBtn = await screen.findByRole("button", {
      name: "Top-up",
    });
    const otherPaymentBtn = screen.getByRole("button", {
      name: "Other payment",
    });
    expect(topUpBtn.className).toContain("bg-emerald-600");
    expect(otherPaymentBtn.className).not.toContain("bg-emerald-600");
  });

  // A legacy/non-bills-only selection has no collection-mode choice at all —
  // its commission has only ever had one path (the "Net payment" tender).
  it("does NOT show the Top-up|Other payment toggle for a legacy batch", async () => {
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
    );

    renderPage();

    fireEvent.click(await screen.findByText("OMT"));
    const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
      "label",
    )!;
    fireEvent.click(within(legacyRow).getByRole("checkbox"));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    await screen.findByText("Confirm Settlement");

    expect(screen.queryByRole("button", { name: "Top-up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Other payment" })).toBeNull();
  });
});

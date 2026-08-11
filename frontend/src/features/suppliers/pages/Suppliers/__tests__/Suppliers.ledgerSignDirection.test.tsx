/** @jest-environment jsdom */
/**
 * LIRA-129 — a `supplier_ledger` row's `EntryTypeBadge` (colored purely off
 * `entry_type`) and its amount cell (colored purely off sign) can disagree.
 * `TOP_UP` is hardcoded red ("debt going up") — correct for the common case
 * (a top-up increases what we owe) but wrong for a SIGNED TOP_UP: an
 * OMT/WHISH RECEIVE books a NEGATIVE TOP_UP (`grossOwedDelta`,
 * FinancialServiceRepository.ts) because it *reduces* what the shop owes the
 * provider. Pre-fix, that row renders a RED "TOP_UP" badge next to a GREEN
 * negative amount — the two things an operator reads say opposite things.
 * NOT partner-specific: a plain walk-in RECEIVE produces the identical row.
 *
 * This is an INTERACTION-layer test (rule 15/17) — it renders the REAL
 * Suppliers page against the REAL, unmodified `EntryTypeBadge` and asserts
 * the rendered badge/amount classes agree, not a props-level shape.
 *
 * Rule 17 (failing-first, LIRA-129 era): pre-fix, `EntryTypeBadge`'s color
 * was a switch on `type` alone (TOP_UP -> always red), independent of sign.
 * Run against a negative TOP_UP row, the pre-fix badge carried the red
 * classes (`bg-red-900/50 text-red-300`) while the amount cell carried the
 * green class (`text-green-400`) -- the "same direction" assertion failed.
 *
 * UPDATED 2026-08-11 (Balance Pages colour audit) -- polarity flip, not a
 * regression. This file's own concrete colour expectations (which family,
 * green or red, "up"/"down" gets) encoded the PRE-audit convention that the
 * audit found backwards against the owner's rule ("positive account should
 * be green, means shop owes the second party"): Suppliers' positive/"UP"
 * ("we owe the supplier more") was red, negative/"DOWN" was green. The
 * audit flips that globally, so every concrete `text-red-400`/`text-green
 * -400`/`red`/`green` expectation below is swapped to match. The actual
 * regression this file guards -- that the badge and the amount cell must
 * agree with EACH OTHER, whichever colour "agree" currently means -- is
 * untouched: only the literal colour each direction maps to changed, not
 * the "badge and amount must never disagree" assertion shape.
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

// Spread the REAL module first (`jest.requireActual`) — this page now also
// imports the shared, presentation-only balance colour helpers
// (`BALANCE_EPS`/`balanceBucket`/`balanceTextColor`, `@liratek/ui`, Balance
// Pages colour audit 2026-08-11), which a plain object-literal mock like the
// old one here would silently turn into `undefined` (a `TypeError` at
// render, not a color mismatch). Only `useApi`/`appEvents`/
// `CounterpartySettleModal`/`PageHeader` need stubbing — everything else
// (including the balance helpers this test exercises) stays real.
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

// A plain walk-in OMT RECEIVE — grossOwedDelta books this NEGATIVE (it
// reduces what the shop owes OMT), signed entry_type TOP_UP (C5 convention).
// NOT a partner/THROUGH row — the ordinary daily-trading case the ticket
// calls out.
const SIGNED_RECEIVE_TOP_UP_ROW = {
  id: 501,
  supplier_id: 1,
  entry_type: "TOP_UP" as const,
  amount_usd: -45.5,
  amount_lbp: 0,
  note: "Auto: RECEIVE via OMT",
  created_by: 1,
  transaction_id: 100,
  is_refunded: 0,
  refunded_at: null,
  created_at: "2026-08-10T09:00:00Z",
};

// Counter-guard: an ordinary positive TOP_UP (a SEND, or a manual top-up)
// must keep reading as "debt going up" — the fix must not flatten every
// TOP_UP to one color regardless of sign.
const ORDINARY_POSITIVE_TOP_UP_ROW = {
  id: 502,
  supplier_id: 1,
  entry_type: "TOP_UP" as const,
  amount_usd: 80,
  amount_lbp: 0,
  note: "Auto: SEND via OMT",
  created_by: 1,
  transaction_id: 101,
  is_refunded: 0,
  refunded_at: null,
  created_at: "2026-08-10T09:05:00Z",
};

const LOTO_SUPPLIER = {
  id: 2,
  name: "LOTO",
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  provider: "LOTO",
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
};

// LotoCheckpointRepository.settleCheckpoint books a POSITIVE SETTLEMENT
// whenever a checkpoint's commission+cash-prizes exceed its sales
// (`netSettlement = totalCommission + totalCashPrizes - totalSales`, stored
// AS-IS, never force-negated like the generic OMT/WHISH settleTransactions()
// path) — a second, independently-discovered entry_type/sign combination the
// pre-fix badge got wrong: EntryTypeBadge hardcoded SETTLEMENT to blue
// regardless of sign, so this row showed a blue badge next to a RED (up)
// amount — not "up" in color, but not agreeing with it either.
const POSITIVE_SETTLEMENT_LOTO_ROW = {
  id: 503,
  supplier_id: 2,
  entry_type: "SETTLEMENT" as const,
  amount_usd: 0,
  amount_lbp: 15000,
  note: "Settlement for checkpoint #9: sales=100000, commission=90000, prizes=25000",
  created_by: 1,
  transaction_id: 200,
  is_refunded: 0,
  refunded_at: null,
  created_at: "2026-08-10T10:00:00Z",
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

describe("Suppliers page — ledger badge/amount direction agreement (LIRA-129)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER, LOTO_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: 34.5, total_lbp: 0 },
      { supplier_id: 2, total_lbp: 0, total_usd: 0 },
    ]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("a NEGATIVE TOP_UP (OMT/WHISH RECEIVE) reads as debt going DOWN on both the badge and the amount", async () => {
    mockGetSupplierLedger.mockResolvedValue([SIGNED_RECEIVE_TOP_UP_ROW]);

    renderPage();

    fireEvent.click((await screen.findAllByText("OMT"))[0]);

    const amountCell = await screen.findByText("-45.50");
    // Owner's rule (2026-08-11): DOWN ("supplier owes us more") is RED —
    // the reverse of this file's pre-audit expectation (was green).
    expect(amountCell.className).toMatch(/text-red-400/);

    const row = amountCell.parentElement as HTMLElement;
    const badge = within(row).getByText("TOP_UP");

    // The defect this test actually guards (unchanged by the polarity flip):
    // pre-LIRA-129, EntryTypeBadge coloured purely off entry_type, so a
    // TOP_UP badge was ALWAYS one fixed colour — contradicting the amount
    // cell's colour whenever the row's sign disagreed with the common case.
    // Post-fix, direction must come from the SAME sign the amount cell uses,
    // so the badge must agree with whichever colour the amount is (now red).
    expect(badge.className).not.toMatch(/green/);
    expect(badge.className).toMatch(/red/);
  });

  it("a POSITIVE TOP_UP (an ordinary SEND/top-up) still reads as debt going UP on both the badge and the amount", async () => {
    mockGetSupplierLedger.mockResolvedValue([ORDINARY_POSITIVE_TOP_UP_ROW]);

    renderPage();

    fireEvent.click((await screen.findAllByText("OMT"))[0]);

    const amountCell = await screen.findByText("+80.00");
    // Owner's rule: UP ("we owe the supplier more") is GREEN — the reverse
    // of this file's pre-audit expectation (was red).
    expect(amountCell.className).toMatch(/text-emerald-400/);

    const row = amountCell.parentElement as HTMLElement;
    const badge = within(row).getByText("TOP_UP");

    expect(badge.className).not.toMatch(/red/);
    expect(badge.className).toMatch(/green/);
  });

  // Independently-discovered second instance (sweep for this ticket, not the
  // reported repro): SETTLEMENT is ALSO written with either sign —
  // LotoCheckpointRepository books `netSettlement` as-is (never negated),
  // which is positive whenever a checkpoint's commission+cash-prizes exceed
  // its sales. Pre-fix, EntryTypeBadge hardcoded SETTLEMENT to blue
  // regardless of sign, so this row's badge never matched (or contradicted)
  // its amount's color. Same fix, same mechanism — proven here on a second,
  // real, reachable entry_type/sign combination.
  it("a POSITIVE SETTLEMENT (LOTO checkpoint, commission+prizes > sales) reads as debt going UP on both the badge and the amount", async () => {
    mockGetSupplierLedger.mockImplementation((supplierId: number) =>
      Promise.resolve(supplierId === 2 ? [POSITIVE_SETTLEMENT_LOTO_ROW] : []),
    );

    renderPage();

    fireEvent.click((await screen.findAllByText("LOTO"))[0]);

    const amountCell = await screen.findByText("+15,000");
    // Owner's rule: UP is GREEN (was red pre-audit).
    expect(amountCell.className).toMatch(/text-emerald-400/);

    const row = amountCell.parentElement as HTMLElement;
    const badge = within(row).getByText("SETTLEMENT");

    expect(badge.className).not.toMatch(/red/);
    expect(badge.className).not.toMatch(/blue/);
    expect(badge.className).toMatch(/green/);
  });
});

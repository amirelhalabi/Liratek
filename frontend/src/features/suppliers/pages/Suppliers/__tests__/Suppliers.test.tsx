/**
 * Suppliers — 5 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 5).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
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

const mockGetSupplierBalances = jest.fn();

const mockGetSupplierProductBalances = jest.fn();

const mockGetSupplierLedger = jest.fn();

const mockGetSupplierProductItems = jest.fn();

const mockGetAllSupplierTransactions = jest.fn();

const mockGetUnsettledTransactions = jest.fn();

const mockSettleTransactions = jest.fn();

const mockAppEventsEmit = jest.fn();

// Spread the REAL module first (`jest.requireActual`) — this page imports
// the shared, presentation-only balance colour helpers (`BALANCE_EPS`/
// `balanceBucket`/`balanceTextColor`, `@liratek/ui`) that this test is
// actually exercising; a plain object-literal mock would turn them into
// `undefined`.
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getSuppliers: mockGetSuppliers,
      getSupplierBalances: mockGetSupplierBalances,
      // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the page now always
      // fetches this too; none of this file's cases exercise an account
      // parent, so a static empty array (no account on this tenant) keeps
      // every existing assertion byte-for-byte unaffected.
      getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
      getSupplierProductBalances: mockGetSupplierProductBalances,
      getSupplierLedger: mockGetSupplierLedger,
      getSupplierProductItems: mockGetSupplierProductItems,
      getAllSupplierTransactions: mockGetAllSupplierTransactions,
      getUnsettledTransactions: mockGetUnsettledTransactions,
      settleTransactions: mockSettleTransactions,
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetSuppliers as unknown as jest.Mock).mockReset();
  (mockGetSupplierBalances as unknown as jest.Mock).mockReset();
  (mockGetSupplierProductBalances as unknown as jest.Mock).mockReset();
  (mockGetSupplierLedger as unknown as jest.Mock).mockReset();
  (mockGetSupplierProductItems as unknown as jest.Mock).mockReset();
  (mockGetAllSupplierTransactions as unknown as jest.Mock).mockReset();
  (mockGetUnsettledTransactions as unknown as jest.Mock).mockReset();
  (mockSettleTransactions as unknown as jest.Mock).mockReset();
  (mockAppEventsEmit as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Suppliers.balanceColourRule", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Balance Pages colour audit (`docs/plans/ongoing_plans/BALANCE_PAGES_UX_AUDIT.md`),
   * owner's rule verbatim (2026-08-10): "Positive account should be green,
   * means shop owes the second party."
   *
   * Suppliers' own documented convention (`balanceColor`/`describeBalance`,
   * this file's `index.tsx`) is POSITIVE total = "WE owe the supplier" — i.e.
   * positive already means "shop owes" on this page, unlike Debts/Partners.
   * Pre-audit, that meaning rendered RED (`text-red-400`) — the exact opposite
   * of the owner's rule, on every balance/badge on the page (latent bug 0a).
   * This test proves the FLIPPED polarity plus the separate exact-zero-renders
   * -red bug on the "Total Owed" summary cards (latent bug #1), which bypassed
   * the page's own `signBucket`/`BALANCE_EPS` entirely.
   *
   * INTERACTION-layer test (rule 15/17) — renders the REAL Suppliers page
   * against the REAL, unmodified `balanceColor`/`describeBalance`/"Total
   * Owed" JSX, not a props-level shape.
   *
   * Rule 17 (failing-first): confirmed by temporarily reverting `balanceColor`/
   * `describeBalance` to the pre-audit branches (`UP -> red`, `DOWN -> green`)
   * and the "Total Owed" cards to the pre-audit bare
   * `totalOwed.usd < 0 ? green : red` (no epsilon) — the "shop owes" case then
   * fails with:
   *   expect(received).toMatch(expected)
   *   Expected pattern: /text-emerald-400/
   *   Received string:  "text-2xl font-bold font-mono text-red-400"
   * and the "exactly settled" case fails with the summary card carrying
   * `text-red-400` instead of a neutral class. Reverted back to the fix after
   * capturing this.
   */

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

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Suppliers />
      </QueryClientProvider>,
    );
  }

  describe("Suppliers page — balance colour (Balance Pages colour audit)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
      mockGetSupplierProductBalances.mockResolvedValue([]);
      mockGetAllSupplierTransactions.mockResolvedValue([]);
      mockGetUnsettledTransactions.mockResolvedValue([]);
      mockGetSupplierLedger.mockResolvedValue([]);
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    });

    it("shop owes the supplier (positive total) renders GREEN, both the summary card and the detail text", async () => {
      mockGetSupplierBalances.mockResolvedValue([
        { supplier_id: 1, total_usd: 34.5, total_lbp: 0 },
      ]);

      renderPage();

      // "$34.50" is ambiguous on its own (the supplier list row shows the
      // identical amount) — scope to the "Total Owed (USD)" card specifically
      // via its label's next sibling, the actual coloured amount div. The
      // label itself renders on mount (before `getSupplierBalances` resolves),
      // so wait for the amount's TEXT to update, not just the label to exist.
      await waitFor(() => {
        const label = screen.getByText("Total Owed (USD)");
        const summaryCard = label.nextElementSibling as HTMLElement;
        expect(summaryCard.textContent?.replace(/\s+/g, "")).toBe("$34.50");
      });
      const summaryCard = screen.getByText("Total Owed (USD)")
        .nextElementSibling as HTMLElement;
      expect(summaryCard.className).toMatch(/text-emerald-400/);
      expect(summaryCard.className).not.toMatch(/text-red-400/);

      fireEvent.click((await screen.findAllByText("OMT"))[0]);

      const detailText = await screen.findByText("You owe $34.50");
      expect(detailText.className).toMatch(/text-emerald-400/);
      expect(detailText.className).not.toMatch(/text-red-400/);
    });

    it("the supplier owes the shop (negative total) renders RED, both the summary card and the detail text", async () => {
      mockGetSupplierBalances.mockResolvedValue([
        { supplier_id: 1, total_usd: -34.5, total_lbp: 0 },
      ]);

      renderPage();

      await waitFor(() => {
        const label = screen.getByText("Total Owed (USD)");
        const summaryCard = label.nextElementSibling as HTMLElement;
        expect(summaryCard.textContent?.replace(/\s+/g, "")).toBe("$-34.50");
      });
      const summaryCard = screen.getByText("Total Owed (USD)")
        .nextElementSibling as HTMLElement;
      expect(summaryCard.className).toMatch(/text-red-400/);
      expect(summaryCard.className).not.toMatch(/text-emerald-400/);

      fireEvent.click((await screen.findAllByText("OMT"))[0]);

      const detailText = await screen.findByText("They owe you $34.50");
      expect(detailText.className).toMatch(/text-red-400/);
      expect(detailText.className).not.toMatch(/text-emerald-400/);
    });

    it("an exactly-settled supplier (total === 0) renders the 'Total Owed' summary card NEUTRAL, not red", async () => {
      mockGetSupplierBalances.mockResolvedValue([
        { supplier_id: 1, total_usd: 0, total_lbp: 0 },
      ]);

      renderPage();

      // Latent bug #1: the "Total Owed" cards bypassed this page's own
      // `signBucket`/`BALANCE_EPS` and used a bare `< 0 ? green : red`, so an
      // all-settled shop rendered its top-of-page balance tile in alarm-red.
      // (An all-zero total is indistinguishable from the pre-fetch default —
      // both are 0 — so this case doesn't need the "wait for a DIFFERENT
      // value to land" treatment the nonzero cases above do; `mockGetSupplierBalances`
      // is still awaited via `findByText` below, which polls until settled.)
      await waitFor(() => expect(mockGetSupplierBalances).toHaveBeenCalled());
      const label = screen.getByText("Total Owed (USD)");
      const summaryCard = label.nextElementSibling as HTMLElement;
      expect(summaryCard.textContent?.replace(/\s+/g, "")).toBe("$0.00");
      expect(summaryCard.className).not.toMatch(/text-red-400/);
      expect(summaryCard.className).toMatch(/text-slate-400/);

      fireEvent.click((await screen.findAllByText("OMT"))[0]);
      expect(await screen.findByText("Settled")).toBeInTheDocument();
    });
  });
});

describe("Suppliers.ledgerSignDirection (LIRA-129)", () => {
  beforeAll(resetBetweenFiles);

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

  // Setup notes from this file (its mocks are the shared ones above):
  // Spread the REAL module first (`jest.requireActual`) — this page now also
  // imports the shared, presentation-only balance colour helpers
  // (`BALANCE_EPS`/`balanceBucket`/`balanceTextColor`, `@liratek/ui`, Balance
  // Pages colour audit 2026-08-11), which a plain object-literal mock like the
  // old one here would silently turn into `undefined` (a `TypeError` at
  // render, not a color mismatch). Only `useApi`/`appEvents`/
  // `CounterpartySettleModal`/`PageHeader` need stubbing — everything else
  // (including the balance helpers this test exercises) stays real.

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
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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
      await openSupplierTable("payments");

      // LIRA-331: the signed amount sits in an <Ltr> (bdi) inside its cell.
      const amountCell = (await screen.findByText("-45.50")).closest(
        "div",
      ) as HTMLElement;
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
      await openSupplierTable("payments");

      // LIRA-331: the signed amount sits in an <Ltr> (bdi) inside its cell.
      const amountCell = (await screen.findByText("+80.00")).closest(
        "div",
      ) as HTMLElement;
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
      await openSupplierTable("payments");

      // LIRA-331: the signed amount sits in an <Ltr> (bdi) inside its cell.
      const amountCell = (await screen.findByText("+15,000")).closest(
        "div",
      ) as HTMLElement;
      // Owner's rule: UP is GREEN (was red pre-audit).
      expect(amountCell.className).toMatch(/text-emerald-400/);

      const row = amountCell.parentElement as HTMLElement;
      const badge = within(row).getByText("SETTLEMENT");

      expect(badge.className).not.toMatch(/red/);
      expect(badge.className).not.toMatch(/blue/);
      expect(badge.className).toMatch(/green/);
    });
  });
});

describe("Suppliers.omtFeeOwedDisplay", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Owner report (2026-10-02): an OMT SEND of $207 + $1 OMT fee showed **$207**
   * in both the commission-settlement checkbox list (Settle tab) and the
   * per-supplier Transactions history table, while the ledger/`supplier_owed`
   * (the repository's single SUPPLIER_OWED_EXPR — principal + fee for a SEND,
   * commission not deducted for `commission_model = 1`) and the app-wide
   * Transactions page both correctly show $208. Owner's rule, verbatim: "we
   * owe OMT the whole amount + fee; the commission is settled separately."
   *
   * Owner decision: both lists' main amount cell = `supplier_owed` (never the
   * raw `amount`), with a small breakdown line underneath ("207 + 1 fee") only
   * when a fee exists AND it actually moved the owed figure away from the raw
   * transfer amount. Also: both lists render newest-first (created_at DESC,
   * id DESC), matching the Transactions page — frontend display only, the
   * repository's own `ORDER BY created_at ASC` (FIFO settlement order) is
   * untouched.
   *
   * NOT proven failing-first: verified by temporarily reverting the fix in
   * place, which rule 17 does not accept.
   */

  // Setup notes from this file (its mocks are the shared ones above):
  // Same mock pattern as the other Suppliers page tests — spread the REAL
  // @liratek/ui module so the shared balance-colour helpers this page also
  // imports stay real; only useApi/appEvents/CounterpartySettleModal/
  // PageHeader are stubbed.

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

  // The owner's exact report: a SEND of $207 + $1 OMT fee. NEW-MODEL
  // (commission_model = 1, primary-cash-drawer): SUPPLIER_OWED_EXPR for a SEND
  // is the GROSS amount — +(amount + fee) — so supplier_owed is 208, not 207.
  const OMT_SEND_OLDER = {
    id: 701,
    service_type: "SEND" as const,
    amount: 207,
    currency: "USD",
    commission: 0,
    omt_fee: 1,
    omt_service_type: "OMT_TRANSFER",
    client_name: null,
    supplier_owed: 208,
    commission_model: 1,
    created_at: "2026-10-01T09:00:00Z",
  };

  // A second, NEWER row with no fee — used to prove the newest-first sort
  // (this one has a LATER created_at than OMT_SEND_OLDER but no breakdown,
  // since it has no fee).
  const OMT_SEND_NEWER_NO_FEE = {
    id: 702,
    service_type: "SEND" as const,
    amount: 50,
    currency: "USD",
    commission: 0,
    omt_fee: null,
    omt_service_type: "OMT_TRANSFER",
    client_name: null,
    supplier_owed: 50,
    commission_model: 1,
    created_at: "2026-10-01T10:00:00Z",
  };

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Suppliers />
      </QueryClientProvider>,
    );
  }

  async function selectOmt() {
    fireEvent.click((await screen.findAllByText("OMT"))[0]);
  }

  describe("Suppliers page — OMT SEND fee owed display (owner report 2026-10-02)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
      mockGetSupplierBalances.mockResolvedValue([
        { supplier_id: 1, total_usd: 208, total_lbp: 0 },
      ]);
      mockGetSupplierProductBalances.mockResolvedValue([]);
      mockGetSupplierLedger.mockResolvedValue([]);
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    });

    it("Settle tab checkbox list: shows $208.00 (supplier_owed) with a '207 + 1 fee' breakdown, not $207.00", async () => {
      mockGetUnsettledTransactions.mockResolvedValue([OMT_SEND_OLDER]);
      mockGetAllSupplierTransactions.mockResolvedValue([]);

      renderPage();
      await selectOmt();

      const amountCell = await screen.findByTestId("settle-row-amount");
      expect(within(amountCell).getByText("$208.00")).toBeInTheDocument();
      expect(within(amountCell).queryByText("$207.00")).toBeNull();
      expect(within(amountCell).getByText("207 + 1 fee")).toBeInTheDocument();
    });

    it("Transactions history table: shows $208.00 (supplier_owed) with a '207 + 1 fee' breakdown, not $207.00", async () => {
      mockGetUnsettledTransactions.mockResolvedValue([]);
      mockGetAllSupplierTransactions.mockResolvedValue([OMT_SEND_OLDER]);

      renderPage();
      await selectOmt();
      await openSupplierTable("transactions");

      const row = await screen.findByTestId("supplier-txn-row-701");
      const amountCell = within(row).getByTestId("supplier-txn-amount");
      expect(within(amountCell).getByText("$208.00")).toBeInTheDocument();
      expect(within(amountCell).queryByText("$207.00")).toBeNull();
      expect(within(amountCell).getByText("207 + 1 fee")).toBeInTheDocument();
    });

    it("Settle tab checkbox list renders newest-first (the 10:00 row before the 09:00 row)", async () => {
      mockGetUnsettledTransactions.mockResolvedValue([
        OMT_SEND_OLDER,
        OMT_SEND_NEWER_NO_FEE,
      ]);
      mockGetAllSupplierTransactions.mockResolvedValue([]);

      renderPage();
      await selectOmt();

      const cells = await screen.findAllByTestId("settle-row-amount");
      expect(cells).toHaveLength(2);
      // Newer row (id 702, no fee, $50.00) first; older row (id 701, $208.00
      // with its breakdown) second.
      expect(within(cells[0]).getByText("$50.00")).toBeInTheDocument();
      expect(within(cells[1]).getByText("$208.00")).toBeInTheDocument();
    });

    it("Transactions history table renders newest-first (the 10:00 row before the 09:00 row)", async () => {
      mockGetUnsettledTransactions.mockResolvedValue([]);
      mockGetAllSupplierTransactions.mockResolvedValue([
        OMT_SEND_OLDER,
        OMT_SEND_NEWER_NO_FEE,
      ]);

      renderPage();
      await selectOmt();
      await openSupplierTable("transactions");

      const rows = await screen.findAllByTestId(/^supplier-txn-row-/);
      expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
        "supplier-txn-row-702",
        "supplier-txn-row-701",
      ]);
    });

    it("a fee-less row shows no breakdown (owed === amount)", async () => {
      mockGetUnsettledTransactions.mockResolvedValue([OMT_SEND_NEWER_NO_FEE]);
      mockGetAllSupplierTransactions.mockResolvedValue([]);

      renderPage();
      await selectOmt();

      const amountCell = await screen.findByTestId("settle-row-amount");
      expect(within(amountCell).getByText("$50.00")).toBeInTheDocument();
      expect(
        within(amountCell).queryByTestId("settle-row-breakdown"),
      ).toBeNull();
    });
  });
});

describe("Suppliers.saleCostNothingOwedStatus (LIRA-122)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-122 — Suppliers page "Transactions" tab showed `SEND | 462,075 LBP |
   * Unpaid` for a plain Katsh item sale (not a bill), while the supplier's
   * overall balance correctly read "Settled". Owner: "in katsh we pay from
   * our own shop balance, nothing is owed... if item other than bill, we dont
   * need to see it in the katsh supplier table. the unpaid is misleading."
   *
   * ROOT CAUSE (packages/core/src/repositories/FinancialServiceRepository.ts):
   * `SUPPLIER_OWED_EXPR`'s cost-flow SEND branch returned bare `cost`
   * unconditionally — correct for a LEGACY row (`supplier_debt_booked = 1`,
   * migration v115 backfill) that booked its own per-sale SALE_COST ledger
   * entry, but wrong for every sale since v115 (`supplier_debt_booked = 0`,
   * the default — the C5 prepaid-units model: the debt is booked ONCE at
   * top-up time via `topUpFromSupplier`'s TOP_UP entry, and the sale itself
   * draws down the provider drawer only). `getUnsettledBySupplier` (the Settle
   * tab) already gated its OWN cost-flow branch on `supplier_debt_booked = 1`
   * — this was a rule-14 violation: the SAME "is this row's cost still owed"
   * question, answered two different ways by two SQL fragments in the same
   * file. The fix reuses ONE definition (SUPPLIER_OWED_EXPR, extended with the
   * same `supplier_debt_booked = 1` gate) in both places.
   *
   * This is an INTERACTION-layer test (rule 15's own admission applies here
   * too — "every backend test passed while this was visibly wrong on
   * screen"): it renders the REAL Suppliers page and asserts the rendered
   * Status badge text, not repository return values.
   *
   * Rule 17 (failing-first): the KATSH_SALE_ROW mock below carries the exact
   * shape `getAllByProvider()`/`FinancialService.getAllByProvider()` compute
   * TODAY (pre-fix) for a post-C5 Katsh item sale — `supplier_owed: cost`
   * (nonzero) and `fifo_status: "unpaid"` (no manual supplier_ledger payments
   * exist to FIFO-cover it). Rendering the REAL, unmodified
   * `Suppliers/index.tsx` against that exact data shows "Unpaid" — confirmed
   * by temporarily reverting the two assertions below to
   * `expect(...).toHaveTextContent("Unpaid")` while feeding the SAME row
   * shape: it passes, i.e. the bug reproduces byte-for-byte. After the
   * repository fix, `getAllByProvider` emits `supplier_owed: 0` /
   * `fifo_status: "paid"` for this exact row instead (see
   * FinancialServiceRepository.saleCost.test.ts's LIRA-122 cases) — this file
   * uses THAT post-fix shape as KATSH_SALE_ROW's canonical, going-forward
   * fixture so it continues to guard the real repository contract. See the
   * task report for the literal pre-fix failure output.
   */

  // Setup notes from this file (its mocks are the shared ones above):
  // render, not a status-badge mismatch). Only the pieces below need
  // stubbing — everything else stays real.

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
  };

  // A plain Katsh ITEM sale (not a bill) — post-C5, `supplier_debt_booked = 0`
  // at the repository (the default since migration v115). The owner's exact
  // report: bought/sold via Katsh's own topped-up balance, nothing owed.
  // `supplier_owed`/`fifo_status` are the FIXED FinancialService.getAllByProvider
  // output for this row (see FinancialServiceRepository.saleCost.test.ts).
  const KATSH_ITEM_SALE_ROW = {
    id: 401,
    service_type: "SEND" as const,
    amount: 462_075, // getSaleCostSettleColumns projects cost AS amount
    currency: "LBP",
    commission: 0,
    cost: 462_075,
    omt_fee: null,
    omt_service_type: null,
    settlement_id: null,
    is_settled: 1,
    supplier_owed: 0,
    fifo_status: "paid" as const,
    fifo_paid_usd: 0,
    created_at: "2026-08-10T09:00:00Z",
  };

  // Counter-guard: a LEGACY Katsh sale (supplier_debt_booked = 1 — it booked
  // its own per-sale SALE_COST ledger entry and is genuinely still owed). The
  // fix must NOT make every cost-flow row look settled — only the ones that
  // truly owe nothing.
  const KATSH_LEGACY_OWED_ROW = {
    id: 402,
    service_type: "SEND" as const,
    amount: 90,
    currency: "USD",
    commission: 0,
    cost: 90,
    omt_fee: null,
    omt_service_type: null,
    settlement_id: null,
    is_settled: 1,
    supplier_owed: 90,
    fifo_status: "unpaid" as const,
    fifo_paid_usd: 0,
    created_at: "2026-08-10T09:05:00Z",
  };

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Suppliers />
      </QueryClientProvider>,
    );
  }

  describe("Suppliers page — Transactions tab status badge (LIRA-122)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
      mockGetSupplierBalances.mockResolvedValue([
        { supplier_id: 1, total_usd: 0, total_lbp: 0 },
      ]);
      mockGetSupplierProductBalances.mockResolvedValue([]);
      mockGetSupplierLedger.mockResolvedValue([]);
      mockGetUnsettledTransactions.mockResolvedValue([]);
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    });

    it("a non-bill Katsh item sale that owes nothing does NOT show a debt-implying status", async () => {
      mockGetAllSupplierTransactions.mockResolvedValue([KATSH_ITEM_SALE_ROW]);

      renderPage();

      fireEvent.click((await screen.findAllByText("Katsh"))[0]);
      await openSupplierTable("transactions");

      // Suppliers decision (2026-10-02): the Amount cell now shows
      // `supplier_owed` (0 for this row — nothing owed), not the raw
      // transfer amount, so the row is no longer locatable by "462,075 LBP"
      // text — select it by its stable row testid instead.
      const row = await screen.findByTestId("supplier-txn-row-401");
      // Same "nothing owed" treatment a wallet-provider transfer already gets
      // — never "Unpaid", "Partial", or any status implying a debt. The
      // Status column is the 4th cell (Type, Amount, Commission, Status,
      // Date) — Commission is ALSO rendered as "—" for a zero-commission
      // cost-flow row, so the plain row-wide query is ambiguous; scope to the
      // Status cell specifically.
      expect(within(row).queryByText("Unpaid")).toBeNull();
      expect(within(row).queryByText("Partial")).toBeNull();
      const statusCell = row.children[3] as HTMLElement;
      expect(within(statusCell).getByText("—")).toBeInTheDocument();
    });

    it("a genuinely-owed LEGACY Katsh sale still shows Unpaid — the fix must not blanket-settle every row", async () => {
      mockGetAllSupplierTransactions.mockResolvedValue([KATSH_LEGACY_OWED_ROW]);

      renderPage();

      fireEvent.click((await screen.findAllByText("Katsh"))[0]);
      await openSupplierTable("transactions");

      await screen.findByText("$90.00");
      const row = await screen.findByTestId("supplier-txn-row-402");
      expect(within(row).getByText("Unpaid")).toBeInTheDocument();
    });
  });
});

describe("Suppliers.voidedTxnStatus (LIRA-258)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * G40 — voided supplier transactions (LIRA-258).
   */

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
  };

  // A plain Katsh ITEM sale (not a bill) — post-C5, `supplier_debt_booked = 0`
  // at the repository (the default since migration v115). The owner's exact
  // report: bought/sold via Katsh's own topped-up balance, nothing owed.
  // `supplier_owed`/`fifo_status` are the FIXED FinancialService.getAllByProvider
  // output for this row (see FinancialServiceRepository.saleCost.test.ts).
  // G40 (LIRA-258, found on cornertech 2026-10-06): a VOIDED row still showed
  // "Unpaid" in the Transactions history and was counted in the unpaid tally
  // and the "Outstanding" total. FinancialService.getAllByProvider now returns
  // fifo_status "voided" for such rows (core guard:
  // FinancialService.voidedFifoStatus.test.ts).
  const VOIDED_ROW = {
    id: 501,
    service_type: "SEND" as const,
    amount: 90,
    currency: "USD",
    commission: 0,
    cost: 90,
    omt_fee: null,
    omt_service_type: null,
    settlement_id: null,
    is_settled: 1,
    is_refunded: 1,
    supplier_owed: 90,
    fifo_status: "voided" as const,
    fifo_paid_usd: 0,
    created_at: "2026-10-06T18:57:58Z",
  };

  const LIVE_UNPAID_ROW = {
    ...VOIDED_ROW,
    id: 502,
    is_refunded: 0,
    fifo_status: "unpaid" as const,
    created_at: "2026-10-06T19:10:00Z",
  };

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Suppliers />
      </QueryClientProvider>,
    );
  }

  describe("Suppliers page — voided rows in the Transactions history (G40)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
      mockGetSupplierBalances.mockResolvedValue([
        { supplier_id: 1, total_usd: 90, total_lbp: 0 },
      ]);
      mockGetSupplierProductBalances.mockResolvedValue([]);
      mockGetSupplierLedger.mockResolvedValue([]);
      mockGetUnsettledTransactions.mockResolvedValue([]);
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
      mockGetAllSupplierTransactions.mockResolvedValue([
        LIVE_UNPAID_ROW,
        VOIDED_ROW,
      ]);
    });

    it("shows a voided row as Voided, never Unpaid", async () => {
      renderPage();
      fireEvent.click((await screen.findAllByText("Katsh"))[0]);
      await openSupplierTable("transactions");

      const voided = await screen.findByTestId("supplier-txn-row-501");
      expect(within(voided).queryByText("Unpaid")).toBeNull();
      expect(within(voided).getByText("Voided")).toBeInTheDocument();

      const live = await screen.findByTestId("supplier-txn-row-502");
      expect(within(live).getByText("Unpaid")).toBeInTheDocument();
    });

    it("leaves the voided row out of the unpaid count and the Outstanding total", async () => {
      renderPage();
      fireEvent.click((await screen.findAllByText("Katsh"))[0]);
      await openSupplierTable("transactions");

      await screen.findByTestId("supplier-txn-row-501");
      expect(screen.getByText(/1\s*unpaid/)).toBeInTheDocument();
      expect(screen.getByText("Outstanding: $90.00")).toBeInTheDocument();
    });
  });
});

/**
 * TransactionsViewer — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";

// LIRA-147 — TransactionsViewer now calls useAuth() (to gate the
// admin-only "Undo refund" button); this suite mounts the page with no
// AuthProvider, so the real hook would throw "useAuth must be used
// within an AuthProvider". Mock it as a non-admin by default — none of
// this file's own assertions are about LIRA-147, so admin visibility is
// irrelevant here; dedicated coverage lives in
// ActionsCell.undoRefund.test.tsx.
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "staff" } }),
}));

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
  voidTransaction: jest.fn(),
  refundTransaction: jest.fn(),
  voidCheckoutGroup: jest.fn(),
  voidSessionBasket: jest.fn(),
  refundSessionBasket: jest.fn(),
  getSaleItems: jest.fn(),
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getSessionItemRefundPreview: jest.fn(),
    refundSessionBasketItem: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("TransactionsViewer.hideRefundItemForPayoutBasket (LIRA-232)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-232 round-3 review (finding 2) — core refuses
   * `refundSessionBasketItem` on a session basket that contains ANY payout
   * member (a loto cash prize, a wallet/Binance cash-out, a custom-service
   * booked as a payout — netted against the basket's other items at checkout).
   * The Transactions page must hide "Refund item" for every OTHER member of
   * that same session too (a SALE line is otherwise refundable on its own),
   * not just offer the button and let it error on click. Written
   * failing-first: at authoring time `TransactionsViewer` had no
   * `sessionsWithPayoutMember` computation and `ActionsCell` had no
   * `hideRefundItem` prop (see `ActionsCell.hideRefundItemForPayoutBasket.
   * test.tsx`, proven failing-first there), so "Refund item" rendered
   * unconditionally for every SESSION_ITEM_REFUNDABLE_TYPES row.
   *
   * LIRA-236 follow-up (2026-09-27 review) — the original detection derived
   * "payout member" from the row's OWN amount sign (`isSessionPayoutMember`,
   * `@liratek/core`). That misses a wallet/Binance cash-out: ITS OWN
   * `transactions` row carries a positive-or-zero amount (only the session's
   * pooled basket-link row carries the negative customer-side amount), so a
   * FINANCIAL_SERVICE payout member's sign check never fired and "Refund item"
   * stayed offered on a basket the server refuses. Every case below now stamps
   * a server-computed `is_session_payout: true` flag directly (core's
   * `getRecent` addition) instead of relying on amount sign — `undefined`/
   * absent reads as NOT a payout (never hidden), matching a REFUND row's own
   * negative amount no longer being misread as a payout either.
   */

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

  function baseRow(overrides: Record<string, unknown>) {
    return {
      id: 1,
      type: "SALE",
      status: "ACTIVE",
      source_table: "sales",
      source_id: 1,
      user_id: 1,
      amount_usd: 0,
      amount_lbp: 0,
      exchange_rate: null,
      client_id: null,
      reverses_id: null,
      summary: null,
      metadata_json: null,
      device_id: null,
      created_at: "2026-09-24 10:00:00",
      username: "cashier",
      client_name: null,
      session_id: null,
      reversed_by_id: null,
      payments: [],
      ...overrides,
    };
  }

  async function renderRows(rows: unknown[]) {
    mockGetRecentTransactions.mockResolvedValue(rows as never);
    render(
      <TransactionsViewer
        limit="50"
        selectedFilters={[]}
        search=""
        from=""
        to=""
      />,
    );
    await waitFor(() => expect(mockGetRecentTransactions).toHaveBeenCalled());
  }

  // LIRA-381 rewrite (rule 24): the three cases that proved "Refund item" is
  // HIDDEN in a basket holding a payout now prove it is SHOWN on every member
  // (owner 2026-11-11 overruled decision 10). Rewritten after the change — not
  // proven failing-first by a run.
  describe("TransactionsViewer — 'Refund item' on a basket with a payout member (LIRA-381; was hidden under LIRA-232 round-3)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetRecentTransactions.mockReset();
    });

    it("shows 'Refund item' on a SALE member AND its sibling LOTO_CASH_PRIZE payout in the same session", async () => {
      const saleRow = baseRow({
        id: 41,
        type: "SALE",
        source_table: "sales",
        source_id: 30,
        session_id: 40,
        client_name: "amir",
        summary: "Sale #30",
        amount_usd: 50,
      });
      const payoutRow = baseRow({
        id: 42,
        type: "LOTO_CASH_PRIZE",
        source_table: "loto_cash_prizes",
        source_id: 1,
        session_id: 40,
        client_name: "amir",
        summary: "Loto cash prize payout",
        // "money OUT = negative amount" — the same convention
        // LotoCashPrizeRepository.createCashPrize stamps.
        amount_usd: 0,
        amount_lbp: -100000,
        is_session_payout: true,
      });
      await renderRows([saleRow, payoutRow]);
      await waitFor(() =>
        expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3),
      );

      // LIRA-381: both the item and the payout keep "Refund item".
      expect(
        screen.getAllByRole("button", { name: "Refund item" }),
      ).toHaveLength(2);
      // The whole-basket actions are still offered too.
      expect(
        screen.getAllByRole("button", { name: "Void basket" }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByRole("button", { name: "Refund basket" }).length,
      ).toBeGreaterThan(0);
    });

    it("still shows 'Refund item' for a session with NO payout member", async () => {
      const saleRow = baseRow({
        id: 43,
        type: "SALE",
        source_table: "sales",
        source_id: 31,
        session_id: 41,
        client_name: "amir",
        summary: "Sale #31",
        amount_usd: 50,
      });
      await renderRows([saleRow]);
      await waitFor(() => screen.getByText("Sale #31", { exact: false }));

      expect(
        screen.getByRole("button", { name: "Refund item" }),
      ).toBeInTheDocument();
    });

    it("a payout member in a DIFFERENT session does not hide this session's 'Refund item'", async () => {
      const saleRowSessionA = baseRow({
        id: 44,
        type: "SALE",
        source_table: "sales",
        source_id: 32,
        session_id: 42,
        client_name: "amir",
        summary: "Sale #32",
        amount_usd: 50,
      });
      const payoutRowSessionB = baseRow({
        id: 45,
        type: "LOTO_CASH_PRIZE",
        source_table: "loto_cash_prizes",
        source_id: 2,
        session_id: 43,
        client_name: "bob",
        summary: "Loto cash prize payout",
        amount_usd: 0,
        amount_lbp: -50000,
        is_session_payout: true,
      });
      await renderRows([saleRowSessionA, payoutRowSessionB]);
      await waitFor(() => screen.getByText("Sale #32", { exact: false }));

      // LIRA-381: one button per session member — the payout's too.
      expect(
        screen.getAllByRole("button", { name: "Refund item" }),
      ).toHaveLength(2);
    });

    it("shows 'Refund item' on a recharge AND a negative-amount CUSTOM_SERVICE payout in the same session", async () => {
      const rechargeRow = baseRow({
        id: 46,
        type: "RECHARGE",
        source_table: "recharges",
        source_id: 5,
        session_id: 44,
        client_name: "amir",
        summary: "MTC recharge",
        amount_usd: 20,
      });
      const customServicePayoutRow = baseRow({
        id: 47,
        type: "CUSTOM_SERVICE",
        source_table: "custom_services",
        source_id: 6,
        session_id: 44,
        client_name: "amir",
        summary: "Custom service payout",
        amount_usd: -15,
        is_session_payout: true,
      });
      await renderRows([rechargeRow, customServicePayoutRow]);
      await waitFor(() =>
        expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3),
      );

      // LIRA-381: both the item and the payout keep "Refund item".
      expect(
        screen.getAllByRole("button", { name: "Refund item" }),
      ).toHaveLength(2);
    });

    // LIRA-236 follow-up (2026-09-27) — the exact gap the flag switch fixes:
    // a wallet/Binance cash-out's OWN `transactions` row carries a positive (or
    // zero) amount; only the session's pooled basket-link row ever carried the
    // negative customer-side amount the old sign-based predicate looked for.
    // FAILING-FIRST on the pre-switch code: `sessionsWithPayoutMember` ignored
    // `is_session_payout` entirely and called `isSessionPayoutMember` on
    // amounts instead, so a positive-amount FINANCIAL_SERVICE row never landed
    // in the set and "Refund item" stayed offered.
    it("shows 'Refund item' on a SALE member AND a FINANCIAL_SERVICE cash-out whose own amount is positive (wallet/Binance)", async () => {
      const saleRow = baseRow({
        id: 50,
        type: "SALE",
        source_table: "sales",
        source_id: 34,
        session_id: 46,
        client_name: "amir",
        summary: "Sale #34",
        amount_usd: 50,
      });
      const walletCashoutRow = baseRow({
        id: 51,
        type: "FINANCIAL_SERVICE",
        source_table: "financial_services",
        source_id: 7,
        session_id: 46,
        client_name: "amir",
        summary: "Binance cash-out",
        // The row's OWN amount is positive/zero — only the pooled basket-link
        // row carries the negative leg. The old amount-sign predicate missed
        // this; the server-computed flag does not.
        amount_usd: 100,
        is_session_payout: true,
      });
      await renderRows([saleRow, walletCashoutRow]);
      await waitFor(() =>
        expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3),
      );

      // LIRA-381: both the item and the payout keep "Refund item".
      expect(
        screen.getAllByRole("button", { name: "Refund item" }),
      ).toHaveLength(2);
    });

    // The flag's other half: absent (undefined) must read as NOT a payout, so
    // a session whose only "negative amount" row is an item-refund REFUND
    // (never flagged is_session_payout) keeps "Refund item" available on its
    // sibling — same guarantee the last test in this file proves below, stated
    // here explicitly per the LIRA-236 follow-up's own wording.
    it("a session with only an item-refund REFUND row (no is_session_payout flag on anything) still shows 'Refund item'", async () => {
      const saleRow = baseRow({
        id: 52,
        type: "SALE",
        source_table: "sales",
        source_id: 35,
        session_id: 47,
        client_name: "amir",
        summary: "Sale #35",
        amount_usd: 50,
      });
      const refundRow = baseRow({
        id: 53,
        type: "REFUND",
        source_table: "sales",
        source_id: 35,
        session_id: 47,
        client_name: "amir",
        summary: "Refund of item",
        amount_usd: -20,
        // Deliberately no `is_session_payout` — a REFUND row is never a payout.
      });
      await renderRows([saleRow, refundRow]);
      await waitFor(() =>
        expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3),
      );

      expect(
        screen.getByRole("button", { name: "Refund item" }),
      ).toBeInTheDocument();
    });

    it("LIRA-232 round-3 finding — keeps 'Refund item' visible on a SALE member after a sibling item-refund REFUND row lands in the same session (the REFUND row's negative amount must NOT read as a payout)", async () => {
      const saleRow = baseRow({
        id: 48,
        type: "SALE",
        source_table: "sales",
        source_id: 33,
        session_id: 45,
        client_name: "amir",
        summary: "Sale #33",
        amount_usd: 50,
      });
      // An item-refund REFUND row linked into the same session — always
      // posted with a NEGATIVE amount since it reverses part of the basket.
      // The hand-written sign check treated this as a "payout member" too,
      // which hid "Refund item" for every remaining basket member after the
      // FIRST item refund.
      const refundRow = baseRow({
        id: 49,
        type: "REFUND",
        source_table: "sales",
        source_id: 33,
        session_id: 45,
        client_name: "amir",
        summary: "Refund of item",
        amount_usd: -20,
      });
      await renderRows([saleRow, refundRow]);
      await waitFor(() =>
        expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3),
      );

      expect(
        screen.getByRole("button", { name: "Refund item" }),
      ).toBeInTheDocument();
    });
  });
});

describe("TransactionsViewer.hideVoidBasketAfterItemRefund (LIRA-232)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-232 round-2 review (finding 2) — a session that already has ANY
   * per-item refund (a `refundSessionBasketItem` REFUND row, identified by
   * `metadata_json.refundType === "sessionItem"`) hard-refuses
   * `voidSessionBasket` server-side (nothing left to cleanly void), so the
   * Transactions page must HIDE "Void basket" for every row of that session —
   * not just the refunded one — leaving "Refund basket" (which reverses only
   * what's left, SESSION_ITEM_REFUND_PLAN.md §9 Q1) and "Refund item"
   * available. Written failing-first: at authoring time TransactionsViewer had
   * no `sessionsWithItemRefund` computation and `ActionsCell` had no
   * `hideVoidBasket` prop, so "Void basket" rendered unconditionally for every
   * reversible session row.
   */

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

  function baseRow(overrides: Record<string, unknown>) {
    return {
      id: 1,
      type: "SALE",
      status: "ACTIVE",
      source_table: "sales",
      source_id: 1,
      user_id: 1,
      amount_usd: 0,
      amount_lbp: 0,
      exchange_rate: null,
      client_id: null,
      reverses_id: null,
      summary: null,
      metadata_json: null,
      device_id: null,
      created_at: "2026-09-24 10:00:00",
      username: "cashier",
      client_name: null,
      session_id: null,
      reversed_by_id: null,
      payments: [],
      ...overrides,
    };
  }

  async function renderRows(rows: unknown[]) {
    mockGetRecentTransactions.mockResolvedValue(rows as never);
    render(
      <TransactionsViewer
        limit="50"
        selectedFilters={[]}
        search=""
        from=""
        to=""
      />,
    );
    await waitFor(() => expect(mockGetRecentTransactions).toHaveBeenCalled());
  }

  describe("TransactionsViewer — hide 'Void basket' once a session has an item refund (LIRA-232)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetRecentTransactions.mockReset();
    });

    it("hides 'Void basket' for a session row once ANY row in that session is a session-item-refund REFUND", async () => {
      const saleRow = baseRow({
        id: 21,
        type: "SALE",
        source_table: "sales",
        source_id: 8,
        session_id: 11,
        client_name: "amir",
        summary: "Sale #8",
      });
      const itemRefundRow = baseRow({
        id: 22,
        type: "REFUND",
        source_table: "sales",
        source_id: 8,
        session_id: 11,
        client_name: "amir",
        summary: "SESSION ITEM REFUND: 1x sale item #9 from Sale #8",
        metadata_json: JSON.stringify({
          refundType: "sessionItem",
          sessionId: 11,
          memberTransactionId: 21,
        }),
      });
      await renderRows([saleRow, itemRefundRow]);
      // Both rows' summaries contain the substring "Sale #8" (the REFUND row's
      // own summary says "... from Sale #8"), so wait for the table to have
      // finished rendering both rows instead of a substring match.
      await waitFor(
        () =>
          expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3), // header + 2 data rows
      );

      expect(
        screen.queryByRole("button", { name: "Void basket" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refund basket" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refund item" }),
      ).toBeInTheDocument();
    });

    it("still renders 'Void basket' for a session with NO item refund", async () => {
      const saleRow = baseRow({
        id: 23,
        type: "SALE",
        source_table: "sales",
        source_id: 9,
        session_id: 12,
        client_name: "amir",
        summary: "Sale #9",
      });
      await renderRows([saleRow]);
      await waitFor(() => screen.getByText("Sale #9", { exact: false }));

      expect(
        screen.getByRole("button", { name: "Void basket" }),
      ).toBeInTheDocument();
    });

    it("an item-refund row in a DIFFERENT session does not hide this session's 'Void basket'", async () => {
      const saleRowSessionA = baseRow({
        id: 24,
        type: "SALE",
        source_table: "sales",
        source_id: 10,
        session_id: 13,
        client_name: "amir",
        summary: "Sale #10",
      });
      const itemRefundRowSessionB = baseRow({
        id: 25,
        type: "REFUND",
        source_table: "sales",
        source_id: 11,
        session_id: 14,
        client_name: "bob",
        summary: "SESSION ITEM REFUND: 1x sale item #99 from Sale #11",
        metadata_json: JSON.stringify({ refundType: "sessionItem" }),
      });
      await renderRows([saleRowSessionA, itemRefundRowSessionB]);
      await waitFor(() => screen.getByText("Sale #10", { exact: false }));

      // Session A's row still shows "Void basket" — only session B (not
      // rendered here as a SALE-typed reversible row) would have it hidden.
      expect(
        screen.getByRole("button", { name: "Void basket" }),
      ).toBeInTheDocument();
    });

    // LIRA-232 round-3 review (finding 3) — `sessionsWithItemRefund` used to be
    // built from `filteredRows` (useTransactionRows.ts), which is narrowed by
    // the operator's active `from`/`to` date filter. A date range that hides
    // the session-item-refund REFUND row (but not the SALE row of the same
    // session) therefore un-hid "Void basket" — even though
    // `voidSessionBasket` still hard-refuses server-side regardless of what
    // the page currently shows. The fix sources `sessionsWithItemRefund` from
    // a SEPARATE, always-unfiltered-by-page-state REFUND-only query inside the
    // hook, so this stays hidden however the table is filtered. NOT proven
    // failing-first as a standalone revert-and-rerun (rule 17/MEMORY —
    // finished code is never re-broken just to re-prove a guard): the bug was
    // proven by reading `useTransactionRows.ts` before the fix (`filteredRows`
    // was the ONLY input to the set) and this test encodes exactly the
    // scenario that reading identified.
    it("keeps 'Void basket' hidden even when the active date filter excludes the item-refund row from the visible table", async () => {
      const saleRow = baseRow({
        id: 31,
        type: "SALE",
        source_table: "sales",
        source_id: 20,
        session_id: 21,
        client_name: "amir",
        summary: "Sale #20",
        created_at: "2026-09-25 10:00:00",
      });
      const itemRefundRow = baseRow({
        id: 32,
        type: "REFUND",
        source_table: "sales",
        source_id: 20,
        session_id: 21,
        client_name: "amir",
        summary: "SESSION ITEM REFUND: 1x sale item #9 from Sale #20",
        // Deliberately OUTSIDE the from/to range passed to the page below —
        // the date filter strips this row out of `filteredRows`, but the
        // dedicated REFUND-only fetch that feeds `sessionsWithItemRefund`
        // ignores `from`/`to` entirely and must still find it.
        created_at: "2026-09-10 10:00:00",
        metadata_json: JSON.stringify({
          refundType: "sessionItem",
          sessionId: 21,
          memberTransactionId: 31,
        }),
      });
      mockGetRecentTransactions.mockResolvedValue([
        saleRow,
        itemRefundRow,
      ] as never);

      render(
        <TransactionsViewer
          limit="50"
          selectedFilters={[]}
          search=""
          from="2026-09-25"
          to="2026-09-25"
        />,
      );
      await waitFor(() => expect(mockGetRecentTransactions).toHaveBeenCalled());
      await waitFor(() => screen.getByText("Sale #20", { exact: false }));

      // The REFUND row is outside the date range and never rendered in the
      // table — but "Void basket" must STILL be hidden for the SALE row.
      expect(screen.queryByText(/SESSION ITEM REFUND/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Void basket" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refund basket" }),
      ).toBeInTheDocument();
    });
  });
});

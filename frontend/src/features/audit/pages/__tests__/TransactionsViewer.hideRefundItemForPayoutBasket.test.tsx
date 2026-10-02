/** @jest-environment jsdom */
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
import { render, screen, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";

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
import { getRecentTransactions } from "@/api/backendApi";

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

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

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

describe("TransactionsViewer — hide 'Refund item' on a basket with a payout member (LIRA-232 round-3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecentTransactions.mockReset();
  });

  it("hides 'Refund item' on a SALE member when a sibling LOTO_CASH_PRIZE payout is in the same session", async () => {
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

    expect(
      screen.queryByRole("button", { name: "Refund item" }),
    ).not.toBeInTheDocument();
    // The whole-basket actions remain the only way to touch this session.
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

    expect(
      screen.getByRole("button", { name: "Refund item" }),
    ).toBeInTheDocument();
  });

  it("hides 'Refund item' when the payout is a negative-amount CUSTOM_SERVICE member flagged is_session_payout (server-derived, not a type list)", async () => {
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

    expect(
      screen.queryByRole("button", { name: "Refund item" }),
    ).not.toBeInTheDocument();
  });

  // LIRA-236 follow-up (2026-09-27) — the exact gap the flag switch fixes:
  // a wallet/Binance cash-out's OWN `transactions` row carries a positive (or
  // zero) amount; only the session's pooled basket-link row ever carried the
  // negative customer-side amount the old sign-based predicate looked for.
  // FAILING-FIRST on the pre-switch code: `sessionsWithPayoutMember` ignored
  // `is_session_payout` entirely and called `isSessionPayoutMember` on
  // amounts instead, so a positive-amount FINANCIAL_SERVICE row never landed
  // in the set and "Refund item" stayed offered.
  it("hides 'Refund item' for a FINANCIAL_SERVICE payout member whose OWN amount is positive but is_session_payout is true (wallet/Binance cash-out)", async () => {
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

    expect(
      screen.queryByRole("button", { name: "Refund item" }),
    ).not.toBeInTheDocument();
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

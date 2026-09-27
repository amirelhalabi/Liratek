/** @jest-environment jsdom */
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
import { render, screen, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
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
    await waitFor(() =>
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
    expect(
      screen.queryByText(/SESSION ITEM REFUND/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Void basket" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refund basket" }),
    ).toBeInTheDocument();
  });
});

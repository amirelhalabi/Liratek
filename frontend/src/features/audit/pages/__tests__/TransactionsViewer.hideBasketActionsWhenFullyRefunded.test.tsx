/** @jest-environment jsdom */
/**
 * Coordinator follow-up (2026-09-27), item 5 — once every item in a session
 * basket has been refunded item by item (`refundSessionBasketItem`), the
 * server now REFUSES both `voidSessionBasket` and `refundSessionBasket`
 * ("Everything in this basket has already been refunded item by item —
 * there is nothing left to refund"). The Transactions page must hide BOTH
 * "Void basket" and "Refund basket" for such a session — offering a button
 * guaranteed to error is the exact bug being closed — driven by each row's
 * server-computed `session_fully_refunded` flag
 * (`TransactionRow.session_fully_refunded`, `getRecent()`'s addition).
 *
 * Written failing-first: at authoring time `ActionsCell` had no
 * `hideBasketActions` prop and `useTransactionRows` had no
 * `sessionsFullyRefunded` set, so "Refund basket"/"Void basket" rendered
 * unconditionally for every reversible session row regardless of
 * `session_fully_refunded`.
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
  getRefundBookedRate: jest.fn(),
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
    session_fully_refunded: false,
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

describe("TransactionsViewer — hide 'Void basket'/'Refund basket' once a session is fully item-refunded (coordinator item 5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecentTransactions.mockReset();
  });

  it("hides BOTH 'Void basket' and 'Refund basket' for a session whose row(s) carry session_fully_refunded: true", async () => {
    const saleRow = baseRow({
      id: 41,
      type: "SALE",
      source_table: "sales",
      source_id: 30,
      session_id: 41,
      client_name: "amir",
      summary: "Sale #30",
      session_fully_refunded: true,
    });
    await renderRows([saleRow]);
    await waitFor(() => screen.getByText("Sale #30", { exact: false }));

    expect(
      screen.queryByRole("button", { name: "Void basket" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refund basket" }),
    ).not.toBeInTheDocument();
  });

  it("still shows 'Refund basket' for a session that is only PARTLY refunded (session_fully_refunded: false)", async () => {
    const saleRow = baseRow({
      id: 42,
      type: "SALE",
      source_table: "sales",
      source_id: 31,
      session_id: 42,
      client_name: "amir",
      summary: "Sale #31",
      session_fully_refunded: false,
    });
    await renderRows([saleRow]);
    await waitFor(() => screen.getByText("Sale #31", { exact: false }));

    expect(
      screen.getByRole("button", { name: "Refund basket" }),
    ).toBeInTheDocument();
  });

  it("session_fully_refunded absent/undefined reads as NOT fully refunded — never hides the basket actions", async () => {
    const saleRow = baseRow({
      id: 43,
      type: "SALE",
      source_table: "sales",
      source_id: 32,
      session_id: 43,
      client_name: "amir",
      summary: "Sale #32",
    });
    delete (saleRow as Record<string, unknown>).session_fully_refunded;
    await renderRows([saleRow]);
    await waitFor(() => screen.getByText("Sale #32", { exact: false }));

    expect(
      screen.getByRole("button", { name: "Refund basket" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Void basket" }),
    ).toBeInTheDocument();
  });
});

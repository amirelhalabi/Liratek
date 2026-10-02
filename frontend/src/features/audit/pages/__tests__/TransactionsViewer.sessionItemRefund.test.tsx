/** @jest-environment jsdom */
/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — the Transactions page's
 * session-group per-item "Refund item" action: a CUSTOM_SERVICE/RECHARGE
 * member refunds straight through (no line concept); a SALE member first
 * asks WHICH line (or "all remaining", owner Q2) via
 * SessionSaleLinePickerModal, then RefundQuantityModal for a single line.
 * Both paths end at the SAME RefundMethodModal (mocked here as a thin stub,
 * matching this file's sibling tests — RefundMethodModal.test.tsx already
 * covers its own internals), driven by `useSessionItemRefund`. Written
 * failing-first: at authoring time `ActionsCell` has no "Refund item" button
 * and TransactionsViewer wires no such handler.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
import { getRecentTransactions, getSaleItems } from "@/api/backendApi";

const mockGetSessionItemRefundPreview = jest.fn();
const mockRefundSessionBasketItem = jest.fn();

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
    getSessionItemRefundPreview: mockGetSessionItemRefundPreview,
    refundSessionBasketItem: mockRefundSessionBasketItem,
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

// Thin stub — same rationale as SaleDetailModal.refundOverride.test.tsx.
jest.mock("@/features/audit/components/RefundMethodModal", () => ({
  RefundMethodModal: ({
    accountReduction,
    onConfirm,
    onCancel,
  }: {
    accountReduction?: { usd: number; lbp: number; clientLabel?: string };
    onConfirm: (refundLegs: undefined) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="refund-method-modal">
      {accountReduction && (
        <span data-testid="stub-account-reduction">
          {accountReduction.clientLabel}:{accountReduction.usd}:
          {accountReduction.lbp}
        </span>
      )}
      <button onClick={() => onConfirm(undefined)}>Confirm Refund (stub)</button>
      <button onClick={onCancel}>Cancel (stub)</button>
    </div>
  ),
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;
const mockGetSaleItems = getSaleItems as jest.MockedFunction<
  typeof getSaleItems
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

describe("TransactionsViewer — session-group per-item refund (LIRA-232)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecentTransactions.mockReset();
  });

  it("a RECHARGE session member: 'Refund item' skips the line picker and opens the refund form directly", async () => {
    const row = baseRow({
      id: 11,
      type: "RECHARGE",
      source_table: "recharges",
      source_id: 3,
      session_id: 7,
      client_name: "amir",
      summary: "Recharge $10",
    });
    await renderRows([row]);
    await waitFor(() => screen.getByText("Recharge $10", { exact: false }));

    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 10,
      accountReductionLbp: 0,
      defaultLegs: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));

    await waitFor(() =>
      expect(mockGetSessionItemRefundPreview).toHaveBeenCalledWith({
        sessionId: 7,
        transactionId: 11,
        saleItemId: undefined,
        quantity: undefined,
      }),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeInTheDocument();
    expect(screen.getByTestId("stub-account-reduction")).toHaveTextContent(
      "amir:10:0",
    );
    expect(mockGetSaleItems).not.toHaveBeenCalled();
  });

  it("a SALE session member: 'Refund item' opens the line picker first, then the quantity step, then the refund form — WITH saleItemId/quantity", async () => {
    const row = baseRow({
      id: 12,
      type: "SALE",
      source_table: "sales",
      source_id: 4,
      session_id: 7,
      client_name: "amir",
      summary: "Sale #4",
    });
    await renderRows([row]);
    await waitFor(() => screen.getByText("Sale #4", { exact: false }));

    mockGetSaleItems.mockResolvedValue([
      {
        id: 9,
        name: "iPhone 13",
        quantity: 1,
        refunded_quantity: 0,
        sold_price_usd: 1500,
      },
    ] as never);

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));

    expect(
      await screen.findByRole("heading", { name: "Refund Which Item?" }),
    ).toBeInTheDocument();
    expect(mockGetSaleItems).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole("button", { name: "Refund" }));

    expect(
      await screen.findByRole("heading", { name: "Refund Item Quantity" }),
    ).toBeInTheDocument();

    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 1500,
      accountReductionLbp: 0,
      defaultLegs: [],
    });

    fireEvent.click(screen.getByRole("button", { name: /Refund 1x/ }));

    await waitFor(() =>
      expect(mockGetSessionItemRefundPreview).toHaveBeenCalledWith({
        sessionId: 7,
        transactionId: 12,
        saleItemId: 9,
        quantity: 1,
      }),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeInTheDocument();
  });

  it("a SALE session member: 'Refund All Remaining' in the line picker skips the quantity step and previews with NO saleItemId", async () => {
    const row = baseRow({
      id: 13,
      type: "SALE",
      source_table: "sales",
      source_id: 5,
      session_id: 8,
      client_name: null,
      summary: "Sale #5",
    });
    await renderRows([row]);
    await waitFor(() => screen.getByText("Sale #5", { exact: false }));

    mockGetSaleItems.mockResolvedValue([
      {
        id: 20,
        name: "Charger",
        quantity: 2,
        refunded_quantity: 0,
        sold_price_usd: 15,
      },
    ] as never);

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));
    await screen.findByRole("heading", { name: "Refund Which Item?" });

    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: [],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Refund All Remaining" }),
    );

    await waitFor(() =>
      expect(mockGetSessionItemRefundPreview).toHaveBeenCalledWith({
        sessionId: 8,
        transactionId: 13,
        saleItemId: undefined,
        quantity: undefined,
      }),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeInTheDocument();
  });

  it("confirming the refund calls refundSessionBasketItem and reloads the table", async () => {
    const row = baseRow({
      id: 14,
      type: "CUSTOM_SERVICE",
      source_table: "custom_services",
      source_id: 6,
      session_id: 9,
      client_name: "amir",
      summary: "Screen repair",
    });
    await renderRows([row]);
    await waitFor(() => screen.getByText("Screen repair", { exact: false }));

    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 50,
      accountReductionLbp: 0,
      defaultLegs: [],
    });
    mockRefundSessionBasketItem.mockResolvedValue({
      success: true,
      refundTransactionId: 700,
    });

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));
    await screen.findByTestId("refund-method-modal");

    fireEvent.click(screen.getByText("Confirm Refund (stub)"));

    await waitFor(() =>
      expect(mockRefundSessionBasketItem).toHaveBeenCalledTimes(1),
    );
    const payload = mockRefundSessionBasketItem.mock.calls[0][0];
    expect(payload.sessionId).toBe(9);
    expect(payload.transactionId).toBe(14);
    // Reloads the table on success.
    await waitFor(() =>
      expect(mockGetRecentTransactions).toHaveBeenCalledTimes(2),
    );
  });

  // LIRA-232 round-2 review (finding 4) — the account line prefers the
  // preview's own `accountClientName` (the "Session Debt" row's actual
  // client) over the row's own `client_name`, which can differ inside a
  // mixed basket. NOT proven failing-first: TransactionsViewer's read landed
  // in the same pass as this test (rule 17/MEMORY).
  it("the refund form's account line uses accountClientName from the preview, not the row's own client_name", async () => {
    const row = baseRow({
      id: 15,
      type: "CUSTOM_SERVICE",
      source_table: "custom_services",
      source_id: 7,
      session_id: 10,
      client_name: "Basket Row Client",
      summary: "Screen repair",
    });
    await renderRows([row]);
    await waitFor(() => screen.getByText("Screen repair", { exact: false }));

    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 50,
      accountReductionLbp: 0,
      accountClientName: "Real Account Holder",
      defaultLegs: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));
    await screen.findByTestId("refund-method-modal");

    expect(screen.getByTestId("stub-account-reduction")).toHaveTextContent(
      "Real Account Holder:50:0",
    );
  });
});

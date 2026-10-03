/** @jest-environment jsdom */
/**
 * Refunding a two-sided swap (EXCHANGE / WALLET_EXCHANGE / DRAWER_TRANSFER)
 * must NOT open the return-method modal: its two legs net to ~0, so the modal
 * pre-fills both currencies as "return" legs and demands $0 — Confirm could
 * never enable. Owner decision: simple swap-back = plain confirm, then
 * refundTransaction(id) with NO refundLegs.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "staff" } }),
}));
import { getRecentTransactions, refundTransaction } from "@/api/backendApi";

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

jest.mock("@/features/audit/components/RefundMethodModal", () => ({
  RefundMethodModal: () => <div data-testid="refund-method-modal" />,
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;
const mockRefundTransaction = refundTransaction as jest.MockedFunction<
  typeof refundTransaction
>;

function swapRow(type: string, source_table: string) {
  return {
    id: 7,
    type,
    status: "ACTIVE",
    source_table,
    source_id: 1,
    user_id: 1,
    amount_usd: -20,
    amount_lbp: 1780000,
    exchange_rate: 89000,
    client_id: null,
    reverses_id: null,
    summary: "Exchange: $20 -> 1,780,000 LBP",
    metadata_json: null,
    device_id: null,
    created_at: "2026-09-24 10:00:00",
    username: "cashier",
    client_name: null,
    session_id: null,
    reversed_by_id: null,
    payments: [
      {
        direction: "in",
        amount: 20,
        signed_amount: 20,
        currency_code: "USD",
        method: "CASH",
      },
      {
        direction: "out",
        amount: 1780000,
        signed_amount: -1780000,
        currency_code: "LBP",
        method: "CASH",
      },
    ],
  };
}

describe.each([
  ["EXCHANGE", "exchange_transactions"],
  ["WALLET_EXCHANGE", "wallet_exchanges"],
  ["DRAWER_TRANSFER", "drawer_transfers"],
])("TransactionsViewer — Refund on a %s swap row", (type, table) => {
  let confirmSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefundTransaction.mockResolvedValue({ success: true } as never);
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => confirmSpy.mockRestore());

  it("uses the plain confirm and refunds with NO refundLegs, never opening the method modal", async () => {
    mockGetRecentTransactions.mockResolvedValue([swapRow(type, table)] as never);
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

    fireEvent.click(await screen.findByRole("button", { name: /^refund$/i }));

    await waitFor(() => expect(mockRefundTransaction).toHaveBeenCalledTimes(1));
    expect(mockRefundTransaction.mock.calls[0][0]).toBe(7);
    expect(mockRefundTransaction.mock.calls[0][1]).toBeUndefined();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("refund-method-modal")).toBeNull();
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-232 round-3 review (finding 4) — "Refund All Remaining" (the SALE
 * session-member line picker's whole-sale option, owner Q2) never loaded any
 * linked phone unit: `openSessionItemPreview`'s unit lookup only ran `if
 * (saleItemId != null)`, and "Refund All Remaining" deliberately omits
 * `saleItemId`. The POS's own whole-sale refund
 * (`SaleDetailModal.openWholeSaleRefund`) always loads every item's units,
 * so the Transactions page's "Refund All Remaining" must match — every
 * REMAINING (not-yet-fully-refunded) line's units, forwarded to
 * RefundMethodModal's `units` prop (the "Returned phones" section) and, once
 * the cashier flags one, through `unitExtras` on confirm.
 *
 * NOT proven failing-first (rule 17/MEMORY): the fix
 * (`TransactionsViewer.tsx`'s `openSessionItemPreview`/
 * `handleRefundAllRemainingSaleLines`) landed in the same pass as this test —
 * but the bug itself was verified by reading the pre-fix source (the unit
 * lookup was unconditionally skipped whenever `saleItemId` was omitted, which
 * "Refund All Remaining" always does) before the edit was made.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import {
  getRecentTransactions,
  getSaleItems,
  getProductUnitsForSaleItems,
} from "@/api/backendApi";

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
  getProductUnitsForSaleItems: jest.fn(),
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

// Same stub shape as SaleDetailModal.refundOverride.test.tsx — exposes the
// `units` prop via a testid so this file can assert on it, unlike the
// sibling TransactionsViewer.sessionItemRefund.test.tsx's stub.
jest.mock("@/features/audit/components/RefundMethodModal", () => ({
  RefundMethodModal: ({
    units = [],
    onConfirm,
    onCancel,
  }: {
    units?: Array<{ id: number; imei: string }>;
    onConfirm: (
      refundLegs: undefined,
      unitExtras?: Array<{ unit_id: number; is_defective?: boolean }>,
    ) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="refund-method-modal">
      <span data-testid="refund-modal-unit-ids">
        {units.map((u) => u.id).join(",")}
      </span>
      <button onClick={() => onConfirm(undefined)}>Confirm Refund (stub)</button>
      <button
        onClick={() =>
          onConfirm(undefined, [{ unit_id: units[0]?.id, is_defective: true }])
        }
      >
        Confirm Refund With Extras (stub)
      </button>
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
const mockGetProductUnitsForSaleItems =
  getProductUnitsForSaleItems as jest.MockedFunction<
    typeof getProductUnitsForSaleItems
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

describe("TransactionsViewer — 'Refund All Remaining' loads linked phone units (LIRA-232 round-3, finding 4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecentTransactions.mockReset();
    mockGetProductUnitsForSaleItems.mockResolvedValue([]);
  });

  it("loads units for every REMAINING (not fully refunded) line, skipping an already-fully-refunded one", async () => {
    const row = baseRow({
      id: 13,
      type: "SALE",
      source_table: "sales",
      source_id: 5,
      session_id: 8,
      client_name: "amir",
      summary: "Sale #5",
    });
    await renderRows([row]);
    await waitFor(() => screen.getByText("Sale #5", { exact: false }));

    mockGetSaleItems.mockResolvedValue([
      {
        id: 20,
        name: "iPhone 13",
        quantity: 1,
        refunded_quantity: 0,
        sold_price_usd: 1500,
      },
      {
        id: 21,
        name: "Charger",
        quantity: 1,
        refunded_quantity: 1, // fully refunded — must NOT be looked up
        sold_price_usd: 15,
      },
    ] as never);
    mockGetProductUnitsForSaleItems.mockResolvedValue([
      { id: 77, imei: "111111111111111" },
    ] as never);
    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));
    await screen.findByRole("heading", { name: "Refund Which Item?" });

    fireEvent.click(
      screen.getByRole("button", { name: "Refund All Remaining" }),
    );

    await waitFor(() =>
      expect(mockGetProductUnitsForSaleItems).toHaveBeenCalledWith([20]),
    );
    expect(await screen.findByTestId("refund-method-modal")).toBeInTheDocument();
    expect(
      await screen.findByTestId("refund-modal-unit-ids"),
    ).toHaveTextContent("77");
  });

  it("forwards unitExtras (2nd onConfirm arg) to refundSessionBasketItem's payload", async () => {
    const row = baseRow({
      id: 14,
      type: "SALE",
      source_table: "sales",
      source_id: 6,
      session_id: 9,
      client_name: "amir",
      summary: "Sale #6",
    });
    await renderRows([row]);
    await waitFor(() => screen.getByText("Sale #6", { exact: false }));

    mockGetSaleItems.mockResolvedValue([
      {
        id: 30,
        name: "iPhone 13",
        quantity: 1,
        refunded_quantity: 0,
        sold_price_usd: 1500,
      },
    ] as never);
    mockGetProductUnitsForSaleItems.mockResolvedValue([
      { id: 88, imei: "222222222222222" },
    ] as never);
    mockGetSessionItemRefundPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: [],
    });
    mockRefundSessionBasketItem.mockResolvedValue({ success: true });

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));
    await screen.findByRole("heading", { name: "Refund Which Item?" });
    fireEvent.click(
      screen.getByRole("button", { name: "Refund All Remaining" }),
    );
    await screen.findByTestId("refund-method-modal");

    fireEvent.click(screen.getByText("Confirm Refund With Extras (stub)"));

    await waitFor(() =>
      expect(mockRefundSessionBasketItem).toHaveBeenCalledTimes(1),
    );
    const payload = mockRefundSessionBasketItem.mock.calls[0][0];
    expect(payload.unitExtras).toEqual([{ unit_id: 88, is_defective: true }]);
  });
});

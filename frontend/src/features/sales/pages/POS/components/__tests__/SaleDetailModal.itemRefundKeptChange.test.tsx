/** @jest-environment jsdom */
/**
 * Refund kept change on the POS "Refund item" button (owner decision
 * 2026-10-07): the per-item refund now offers the SAME kept-change option
 * the whole-sale "Refund Sale" button already has — RefundMethodModal is
 * opened with `allowKeptChange`, and the kept amount it reports (onConfirm's
 * 4th argument) reaches `api.refundSaleItem` as its 7th argument. Without a
 * kept amount the call is unchanged (six arguments).
 *
 * RefundMethodModal is a thin stub here (its own kept-change UI is proven in
 * RefundMethodModal.keptChange.test.tsx); this file proves the WIRING only.
 * The kept object is built through the shared core schema
 * (`refundKeptChangeSchema`, rule 24). The `useApi` mock returns ONE stable
 * object (rule 25).
 *
 * Rule 17: written before SaleDetailModal was changed; failure text is in
 * the change report.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { refundKeptChangeSchema } from "@liratek/core";
import SaleDetailModal from "../SaleDetailModal";

const mockGetSale = jest.fn();
const mockGetSaleItems = jest.fn();
const mockGetSaleRefundPreview = jest.fn();
const mockRefundSale = jest.fn();
const mockRefundSaleItem = jest.fn();

const KEPT = refundKeptChangeSchema.parse({
  kept_change_usd: 0.12,
  kept_change_lbp: 0,
});
const LEGS = [{ method: "CASH", currencyCode: "USD", amount: 20 }];

const mockApi = {
  getSale: mockGetSale,
  getSaleItems: mockGetSaleItems,
  getSaleRefundPreview: mockGetSaleRefundPreview,
  refundSale: mockRefundSale,
  refundSaleItem: mockRefundSaleItem,
  updateSaleMetadata: jest.fn(),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getSessionItemRefundPreview: jest.fn(),
  refundSessionBasketItem: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/api/backendApi", () => ({
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/features/audit/components/RefundMethodModal", () => ({
  RefundMethodModal: ({
    allowKeptChange,
    onConfirm,
  }: {
    allowKeptChange?: boolean;
    onConfirm: (
      legs?: unknown,
      unitExtras?: unknown,
      rate?: number,
      kept?: unknown,
    ) => void;
  }) => (
    <div data-testid="refund-method-modal">
      <span data-testid="allow-kept">{String(!!allowKeptChange)}</span>
      <button onClick={() => onConfirm(LEGS, undefined, 90000, KEPT)}>
        Confirm With Kept (stub)
      </button>
      <button onClick={() => onConfirm(LEGS, undefined, 90000)}>
        Confirm Without Kept (stub)
      </button>
    </div>
  ),
}));

const SALE = {
  id: 4,
  client_id: null,
  client_name: "Walk-in Customer",
  client_phone: null,
  total_amount_usd: 25.12,
  discount_usd: 0,
  final_amount_usd: 25.12,
  paid_usd: 25.12,
  paid_lbp: 0,
  change_given_usd: 0,
  change_given_lbp: 0,
  exchange_rate_snapshot: 90000,
  status: "completed",
  created_at: "2026-10-07 10:00:00",
};

const ITEM = {
  id: 9,
  sale_id: 4,
  product_id: 1,
  quantity: 1,
  sold_price_usd: 20.12,
  name: "Charger",
  barcode: "12345",
  refunded_quantity: 0,
};

async function openItemRefund() {
  render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
  await screen.findByText("Sale #4");
  fireEvent.click(await screen.findByTitle("Refund item"));
  fireEvent.click(await screen.findByText(/Refund 1x/));
  await screen.findByTestId("refund-method-modal");
}

describe("SaleDetailModal — kept change on the per-item refund", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSale.mockResolvedValue(SALE);
    mockGetSaleItems.mockResolvedValue([ITEM]);
    mockGetSaleRefundPreview.mockResolvedValue({
      success: true,
      legs: [],
      sessionLinked: false,
      bookedRate: 90000,
      bookedRateSource: "sale",
    });
    mockRefundSaleItem.mockResolvedValue({ success: true, refundId: 700 });
  });

  it('"Refund item" opens the refund window with kept change allowed', async () => {
    await openItemRefund();
    expect(screen.getByTestId("allow-kept")).toHaveTextContent("true");
  });

  it("forwards the kept amount to api.refundSaleItem as the 7th argument", async () => {
    await openItemRefund();
    fireEvent.click(screen.getByText("Confirm With Kept (stub)"));
    await waitFor(() =>
      expect(mockRefundSaleItem).toHaveBeenCalledWith(
        4,
        9,
        1,
        LEGS,
        undefined,
        90000,
        KEPT,
      ),
    );
  });

  it("without a kept amount the call is unchanged (six arguments)", async () => {
    await openItemRefund();
    fireEvent.click(screen.getByText("Confirm Without Kept (stub)"));
    await waitFor(() => expect(mockRefundSaleItem).toHaveBeenCalledTimes(1));
    expect(mockRefundSaleItem.mock.calls[0]).toEqual([
      4,
      9,
      1,
      LEGS,
      undefined,
      90000,
    ]);
    expect(mockRefundSaleItem.mock.calls[0]).toHaveLength(6);
  });
});

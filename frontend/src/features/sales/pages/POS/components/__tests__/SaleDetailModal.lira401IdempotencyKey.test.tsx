/** @jest-environment jsdom */
/**
 * LIRA-401 — the POS sale window's refund popup (a modal form) sends a
 * one-time `idempotencyKey` with `api.refundSaleItem`:
 *   - a double tap on Confirm while the first request is still running
 *     sends the SAME key (the server books the refund once);
 *   - the next opening of the popup gets a NEW key (a second, real refund
 *     is a second booking).
 *
 * Not proven failing-first (rule 17): written after the wiring; never run
 * against the page without it. Setup copied from
 * SaleDetailModal.itemRefundKeptChange.test.tsx (stable `useApi`, rule 25).
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

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

function keyOfCall(n: number): unknown {
  // refundSaleItem(saleId, itemId, qty, legs, extras, rate, kept, opts)
  const opts = mockRefundSaleItem.mock.calls[n][7] as
    | { idempotencyKey?: string }
    | undefined;
  return opts?.idempotencyKey;
}

describe("SaleDetailModal — LIRA-401 refund idempotency key", () => {
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
  });

  it("a double tap in one popup shares a key; the next popup gets a new one", async () => {
    let release: (v: {
      success: boolean;
      refundId?: number;
    }) => void = () => {};
    mockRefundSaleItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mockRefundSaleItem.mockImplementation(async () => ({
      success: true,
      refundId: 701,
    }));

    await openItemRefund();
    const confirm = screen.getByText("Confirm Without Kept (stub)");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mockRefundSaleItem).toHaveBeenCalledTimes(2));
    const first = keyOfCall(0);
    expect(first).toEqual(expect.stringMatching(KEY_PATTERN));
    expect(keyOfCall(1)).toBe(first);

    release({ success: true, refundId: 700 });
    await waitFor(() =>
      expect(screen.queryByTestId("refund-method-modal")).toBeNull(),
    );

    // A second, real refund: the popup opens again with a fresh key.
    fireEvent.click(await screen.findByTitle("Refund item"));
    fireEvent.click(await screen.findByText(/Refund 1x/));
    fireEvent.click(await screen.findByText("Confirm Without Kept (stub)"));
    await waitFor(() => expect(mockRefundSaleItem).toHaveBeenCalledTimes(3));
    const third = keyOfCall(2);
    expect(third).toEqual(expect.stringMatching(KEY_PATTERN));
    expect(third).not.toBe(first);
  });
});

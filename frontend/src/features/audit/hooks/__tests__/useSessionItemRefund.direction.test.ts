/** @jest-environment jsdom */
/**
 * LIRA-381 — refunding a basket PAYOUT member (a loto prize, a cash-out):
 * the hook takes the money's direction from core's preview, never from the
 * row (a RECEIVE row's own amount is positive), and an exchange / a member
 * paid on its own is refunded exactly as paid with no method window.
 *
 * Written after the hook change (not proven failing-first by a run): on the
 * pre-LIRA-381 hook the preview state had no `direction` and `open()` always
 * opened the method window.
 */
import { renderHook, act } from "@testing-library/react";
import type { SessionItemRefundInput } from "@liratek/core";
import { useSessionItemRefund } from "../useSessionItemRefund";

const mockGetPreview = jest.fn();
const mockRefund = jest.fn();
const mockApi = {
  getSessionItemRefundPreview: mockGetPreview,
  refundSessionBasketItem: mockRefund,
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const PRIZE_LEG = {
  direction: "in" as const,
  amount: 500_000,
  signed_amount: 500_000,
  currency_code: "LBP",
  method: "CASH",
  drawer_name: "General",
};

function preview(overrides: Record<string, unknown>) {
  return {
    success: true,
    itemAmountUsd: 0,
    itemAmountLbp: 500_000,
    accountReductionUsd: 0,
    accountReductionLbp: 0,
    remainderUsd: 0,
    remainderLbp: 500_000,
    defaultLegs: [PRIZE_LEG],
    bookedRate: 89_000,
    bookedRateSource: "transaction",
    direction: "from_customer",
    paidOnItsOwn: false,
    ...overrides,
  };
}

describe("useSessionItemRefund — direction (LIRA-381)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens the window in the 'customer pays back' direction for a payout member", async () => {
    mockGetPreview.mockResolvedValue(preview({}));
    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
    await act(async () => {
      await result.current.open({
        sessionId: 3,
        transactionId: 77,
        transactionType: "LOTO_CASH_PRIZE",
      });
    });
    expect(result.current.preview?.direction).toBe("from_customer");
    expect(result.current.preview?.legs).toEqual([PRIZE_LEG]);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("a confirmed payout refund sends the customer's lines in the schema's own refundLegs field", async () => {
    mockGetPreview.mockResolvedValue(preview({}));
    mockRefund.mockResolvedValue({ success: true });
    const onRefunded = jest.fn();
    const { result } = renderHook(() => useSessionItemRefund(onRefunded));
    await act(async () => {
      await result.current.open({ sessionId: 3, transactionId: 77 });
    });
    await act(async () => {
      await result.current.confirm(
        [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 500_000 }],
        undefined,
        89_000,
      );
    });
    const sent = mockRefund.mock.calls[0][0] as SessionItemRefundInput;
    expect(sent.refundLegs).toEqual([
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 500_000 },
    ]);
    expect(Object.keys(sent)).not.toContain("direction");
    expect(onRefunded).toHaveBeenCalled();
  });

  it("a member paid on its own (an exchange) is refunded straight away after the plain confirm — no window", async () => {
    mockGetPreview.mockResolvedValue(
      preview({
        direction: "to_customer",
        paidOnItsOwn: true,
        defaultLegs: [],
      }),
    );
    mockRefund.mockResolvedValue({ success: true });
    const confirmExact = jest.fn(() => true);
    const onRefunded = jest.fn();
    const { result } = renderHook(() =>
      useSessionItemRefund(onRefunded, { confirmExact }),
    );
    await act(async () => {
      await result.current.open({
        sessionId: 3,
        transactionId: 78,
        transactionType: "EXCHANGE",
      });
    });
    expect(confirmExact).toHaveBeenCalledTimes(1);
    expect(result.current.preview).toBeNull();
    const sent = mockRefund.mock.calls[0][0] as SessionItemRefundInput;
    expect(sent.refundLegs).toBeUndefined();
    expect(sent).toMatchObject({ sessionId: 3, transactionId: 78 });
    expect(onRefunded).toHaveBeenCalled();
  });

  it("the plain confirm declined → nothing is sent", async () => {
    mockGetPreview.mockResolvedValue(preview({ paidOnItsOwn: true }));
    const { result } = renderHook(() =>
      useSessionItemRefund(jest.fn(), { confirmExact: () => false }),
    );
    await act(async () => {
      await result.current.open({ sessionId: 3, transactionId: 78 });
    });
    expect(mockRefund).not.toHaveBeenCalled();
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4/§7) — the shared preview→confirm
 * orchestration behind BOTH the Transactions-page session-group "Refund"
 * action and the POS session-sale refund flow (rule 14 — one place, not two
 * copies). Written failing-first: at the time this test was authored the
 * hook module did not exist at all.
 */
import { renderHook, act } from "@testing-library/react";
import { useSessionItemRefund } from "../useSessionItemRefund";
import { appEvents } from "@liratek/ui";

const mockGetPreview = jest.fn();
const mockRefund = jest.fn();

// LIRA-236 round-2/final review, finding F10 (LOW, rule 25) — this USED to
// return a fresh object literal on every `useApi()` call, on the theory that
// nothing here put `api` in an automatically-firing effect's dependency
// array. `useSessionItemRefund` now reads `api` through a stable `apiRef`
// regardless, so a stable mock identity is no longer just "safe" but the
// thing that actually exercises that ref pattern — an unstable mock is
// exactly what CurrencyContext.authGate.test.tsx uses to catch a REAL
// infinite-loop regression elsewhere (rule 25's own canonical example), so
// this file now matches production's stable-singleton shape instead of the
// unstable one.
const mockApi = {
  getSessionItemRefundPreview: mockGetPreview,
  refundSessionBasketItem: mockRefund,
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const DEFAULT_LEGS = [
  {
    direction: "in" as const,
    amount: 10,
    signed_amount: 10,
    currency_code: "USD",
    method: "CASH",
  },
];

describe("useSessionItemRefund", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("open() fetches the preview and exposes accountReduction + defaultLegs", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      itemAmountUsd: 15,
      itemAmountLbp: 0,
      itemCurrency: "USD",
      accountReductionUsd: 15,
      accountReductionLbp: 0,
      remainderAmount: 0,
      remainderUsd: 0,
      remainderLbp: 0,
      defaultLegs: [],
    });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));

    await act(async () => {
      await result.current.open({
        sessionId: 1,
        transactionId: 55,
        saleItemId: 9,
        quantity: 1,
        clientLabel: "amir",
      });
    });

    expect(mockGetPreview).toHaveBeenCalledWith({
      sessionId: 1,
      transactionId: 55,
      saleItemId: 9,
      quantity: 1,
    });
    expect(result.current.preview).toEqual({
      target: {
        sessionId: 1,
        transactionId: 55,
        saleItemId: 9,
        quantity: 1,
        clientLabel: "amir",
      },
      legs: [],
      accountReductionUsd: 15,
      accountReductionLbp: 0,
    });
  });

  // LIRA-232 round-2 review (finding 4) — `accountClientName` (the "Session
  // Debt" row's OWN client, which can differ from `target.clientLabel`
  // inside a mixed basket) is read off the preview when present. NOT proven
  // failing-first: `useSessionItemRefund.ts`'s read landed in the same pass
  // as this test.
  it("open() carries accountClientName off the preview when present", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 15,
      accountReductionLbp: 0,
      accountClientName: "Real Account Holder",
      defaultLegs: [],
    });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));

    await act(async () => {
      await result.current.open({
        sessionId: 1,
        transactionId: 55,
        clientLabel: "Basket Row Client",
      });
    });

    expect(result.current.preview?.accountClientName).toBe(
      "Real Account Holder",
    );
  });

  // Absent from the response (the pre-fix shape, or a currently-unbuilt
  // core) must not crash or synthesize a value.
  it("open() leaves accountClientName undefined when the preview omits it", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));

    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });

    expect(result.current.preview?.accountClientName).toBeUndefined();
  });

  it("open() omits saleItemId/quantity for a whole-member refund (Q2)", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));

    await act(async () => {
      await result.current.open({ sessionId: 1, transactionId: 55 });
    });

    expect(mockGetPreview).toHaveBeenCalledWith({
      sessionId: 1,
      transactionId: 55,
      saleItemId: undefined,
      quantity: undefined,
    });
  });

  it("open() surfaces a failed preview as a notification and does not set preview", async () => {
    mockGetPreview.mockResolvedValue({ success: false, error: "nope" });
    const emitSpy = jest.spyOn(appEvents, "emit");

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));

    await act(async () => {
      await result.current.open({ sessionId: 1, transactionId: 55 });
    });

    expect(emitSpy).toHaveBeenCalledWith("notification:show", "nope", "error");
    expect(result.current.preview).toBeNull();
  });

  it("confirm() with no override sends refundLegs=undefined, stamps clientDay, and calls onRefunded", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 15,
      accountReductionLbp: 0,
      defaultLegs: [],
    });
    mockRefund.mockResolvedValue({ success: true, refundTransactionId: 900 });
    const onRefunded = jest.fn();

    const { result } = renderHook(() => useSessionItemRefund(onRefunded));
    await act(async () => {
      await result.current.open({
        sessionId: 1,
        transactionId: 55,
        saleItemId: 9,
        quantity: 1,
      });
    });

    await act(async () => {
      await result.current.confirm(undefined);
    });

    expect(mockRefund).toHaveBeenCalledTimes(1);
    const payload = mockRefund.mock.calls[0][0];
    expect(payload.sessionId).toBe(1);
    expect(payload.transactionId).toBe(55);
    expect(payload.saleItemId).toBe(9);
    expect(payload.quantity).toBe(1);
    expect(payload.refundLegs).toBeUndefined();
    expect(typeof payload.clientDay).toBe("string");
    expect(payload.clientDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(onRefunded).toHaveBeenCalledTimes(1);
    // Confirming clears the open preview.
    expect(result.current.preview).toBeNull();
  });

  it("confirm() with an override forwards refundLegs in the schema's own field names", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });
    mockRefund.mockResolvedValue({ success: true, refundTransactionId: 901 });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });

    await act(async () => {
      await result.current.confirm([
        { method: "OMT", currencyCode: "USD", amount: 10 },
      ]);
    });

    const payload = mockRefund.mock.calls[0][0];
    expect(payload.refundLegs).toEqual([
      { method: "OMT", currencyCode: "USD", amount: 10 },
    ]);
  });

  it("confirm() forwards unitExtras as a distinct field when provided", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });
    mockRefund.mockResolvedValue({ success: true, refundTransactionId: 902 });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });

    await act(async () => {
      await result.current.confirm(undefined, [
        { unit_id: 5, is_defective: true },
      ]);
    });

    const payload = mockRefund.mock.calls[0][0];
    expect(payload.unitExtras).toEqual([{ unit_id: 5, is_defective: true }]);
  });

  it("confirm() surfaces a failed refund as a notification and does not call onRefunded", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });
    mockRefund.mockResolvedValue({ success: false, error: "boom" });
    const onRefunded = jest.fn();
    const emitSpy = jest.spyOn(appEvents, "emit");

    const { result } = renderHook(() => useSessionItemRefund(onRefunded));
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });
    await act(async () => {
      await result.current.confirm(undefined);
    });

    expect(emitSpy).toHaveBeenCalledWith("notification:show", "boom", "error");
    expect(onRefunded).not.toHaveBeenCalled();
  });

  // LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md) — written failing-first: at
  // authoring time `confirm()` took only (refundLegsInput, unitExtras); a 3rd
  // `exchangeRate` argument was a TypeScript error, and `preview` carried no
  // `bookedRate`/`bookedRateSource`/`changeRate`.
  it("confirm() forwards exchangeRate as a distinct payload field when passed as the 3rd argument", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });
    mockRefund.mockResolvedValue({ success: true, refundTransactionId: 903 });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });

    await act(async () => {
      await result.current.confirm(
        [{ method: "CASH", currencyCode: "LBP", amount: 890_000 }],
        undefined,
        89000,
      );
    });

    const payload = mockRefund.mock.calls[0][0];
    expect(payload.exchangeRate).toBe(89000);
  });

  // LIRA-236 round-2/final review, finding F2 (HIGH) — REWRITTEN (rule 24)
  // from "confirm() with no rate argument omits exchangeRate from the
  // payload" into a two-part guard of the actual contract: an untouched rate
  // still sends nothing, and a CHANGED rate is always sent — even with no
  // `refundLegs`/`unitExtras` override at all, which is exactly the shape
  // `RefundMethodModal.handleConfirm` now sends when the operator typed a
  // new rate but the resulting line set still equals the (re-previewed)
  // default (the bug: the popup used to drop the rate there entirely, and
  // the server silently applied the OLD booked rate). This hook's own
  // `confirm()` needed no code change to satisfy the second half — it already
  // forwarded whatever `exchangeRate` argument it was given, independent of
  // `refundLegsInput` — so this rewrite is NOT proven failing-first (rule
  // 17): the real bug/fix lives in `RefundMethodModal.tsx`'s own
  // `handleConfirm` (see RefundMethodModal.test.tsx's F2 describe block for
  // the failing-first proof at that layer). This test pins the hook's half
  // of the contract so it can never silently regress underneath the fix.
  it("confirm(): an untouched rate sends no exchangeRate; a CHANGED rate is always sent, even with no legs/unitExtras override", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });
    mockRefund.mockResolvedValue({ success: true, refundTransactionId: 904 });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));

    // Untouched: no rate argument at all.
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });
    await act(async () => {
      await result.current.confirm(undefined);
    });
    expect(mockRefund.mock.calls[0][0].exchangeRate).toBeUndefined();

    // Changed: a rate argument with BOTH refundLegs and unitExtras omitted
    // (the "line set still equals the default" case) still reaches the
    // payload.
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });
    await act(async () => {
      await result.current.confirm(undefined, undefined, 90000);
    });
    expect(mockRefund.mock.calls[1][0].exchangeRate).toBe(90000);
    expect(mockRefund.mock.calls[1][0].refundLegs).toBeUndefined();
    expect(mockRefund.mock.calls[1][0].unitExtras).toBeUndefined();
  });

  it("open() carries bookedRate/bookedRateSource off the preview when present", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
      bookedRate: 91000,
      bookedRateSource: "sale",
    });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });

    expect(result.current.preview?.bookedRate).toBe(91000);
    expect(result.current.preview?.bookedRateSource).toBe("sale");
  });

  it("changeRate() debounces a re-preview call with the new exchangeRate, updating legs/accountReduction/bookedRate", async () => {
    jest.useFakeTimers();
    try {
      mockGetPreview.mockResolvedValueOnce({
        success: true,
        accountReductionUsd: 15,
        accountReductionLbp: 0,
        defaultLegs: DEFAULT_LEGS,
        bookedRate: 89000,
        bookedRateSource: "sale",
      });

      const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
      await act(async () => {
        await result.current.open({
          sessionId: 2,
          transactionId: 60,
          saleItemId: 9,
          quantity: 1,
        });
      });

      mockGetPreview.mockResolvedValueOnce({
        success: true,
        accountReductionUsd: 14,
        accountReductionLbp: 90_000,
        defaultLegs: [],
        bookedRate: 90000,
        bookedRateSource: "sale",
      });

      act(() => {
        result.current.changeRate(90000);
      });
      // Not fetched yet — debounced.
      expect(mockGetPreview).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockGetPreview).toHaveBeenCalledTimes(2);
      const secondCallPayload = mockGetPreview.mock.calls[1][0];
      expect(secondCallPayload).toMatchObject({
        sessionId: 2,
        transactionId: 60,
        saleItemId: 9,
        quantity: 1,
        exchangeRate: 90000,
      });
      expect(result.current.preview?.accountReductionUsd).toBe(14);
      expect(result.current.preview?.accountReductionLbp).toBe(90_000);
      expect(result.current.preview?.legs).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancel() clears the open preview without calling the API", async () => {
    mockGetPreview.mockResolvedValue({
      success: true,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      defaultLegs: DEFAULT_LEGS,
    });

    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
    await act(async () => {
      await result.current.open({ sessionId: 2, transactionId: 60 });
    });
    expect(result.current.preview).not.toBeNull();

    act(() => {
      result.current.cancel();
    });

    expect(result.current.preview).toBeNull();
    expect(mockRefund).not.toHaveBeenCalled();
  });
});

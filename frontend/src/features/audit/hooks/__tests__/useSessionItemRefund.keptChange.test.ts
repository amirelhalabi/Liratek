/** @jest-environment jsdom */
/**
 * Refund kept change (owner decision 2026-10-07) — the session item refund
 * hook puts the popup's kept amount on the SAME payload (rule 22), under the
 * shared schema's own flat keys (rule 24: names taken from
 * `refundKeptChangeSchema` / `sessionItemRefundSchema`).
 *
 * Rule 17 disclosure: written AFTER the hook change — NOT proven
 * failing-first.
 */
import { renderHook, act } from "@testing-library/react";
import { refundKeptChangeSchema, sessionItemRefundSchema } from "@liratek/core";
import { useSessionItemRefund } from "../useSessionItemRefund";

const mockGetPreview = jest.fn();
const mockRefund = jest.fn();
// Stable identity, like production's singleton adapter (rule 25).
const mockApi = {
  getSessionItemRefundPreview: mockGetPreview,
  refundSessionBasketItem: mockRefund,
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

describe("useSessionItemRefund — kept change", () => {
  beforeEach(() => jest.clearAllMocks());

  async function openAndConfirm(kept?: {
    kept_change_usd: number;
    kept_change_lbp: number;
  }) {
    mockGetPreview.mockResolvedValue({
      success: true,
      itemAmountUsd: 20.12,
      itemAmountLbp: 0,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      remainderUsd: 20.12,
      remainderLbp: 0,
      defaultLegs: [],
      bookedRate: 89000,
      bookedRateSource: "sale",
    });
    mockRefund.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useSessionItemRefund(jest.fn()));
    await act(async () => {
      await result.current.open({
        sessionId: 1,
        transactionId: 55,
        saleItemId: 9,
        quantity: 1,
        transactionType: "SALE",
      });
    });
    const legs = [{ method: "CASH", currencyCode: "USD" as const, amount: 20 }];
    await act(async () => {
      await result.current.confirm(legs, undefined, 89000, kept);
    });
    return mockRefund.mock.calls[0][0] as Record<string, unknown>;
  }

  it("sends kept_change_usd/lbp on the refund payload", async () => {
    const kept = refundKeptChangeSchema.parse({
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    }) as { kept_change_usd: number; kept_change_lbp: number };
    const payload = await openAndConfirm(kept);
    // The payload is exactly what the server schema accepts, kept included.
    expect(sessionItemRefundSchema.parse(payload)).toMatchObject({
      kept_change_usd: 0.12,
      kept_change_lbp: 0,
    });
  });

  it("no kept change → no kept keys on the payload", async () => {
    const payload = await openAndConfirm();
    expect(payload).not.toHaveProperty("kept_change_usd");
    expect(payload).not.toHaveProperty("kept_change_lbp");
  });
});

/** @jest-environment jsdom */

/**
 * LIRA-258 (G23 rollout) — "Settle All" must post the payment ONCE.
 *
 * The dialog used to loop over every unsettled checkpoint and call the
 * per-checkpoint `settle` with the SAME payment legs — the combined net of
 * ALL checkpoints — on every call. Pre-G23 that booked the full payment N
 * times; post-G23 the repository refuses legs that don't add up to that one
 * checkpoint's own net, so settling two checkpoints failed outright (or, with
 * opposite-sign nets, could not be split at all).
 *
 * The fix: one atomic `settleBatch` call with the combined legs (the batch
 * repository reconciles them against the combined net), carrying the till's
 * buy rate as `tender_exchange_rate`. The per-checkpoint `settle` is still
 * used only for "Create Checkpoint & Settle" (exactly one checkpoint).
 *
 * Captured payloads are parsed through the core schemas (rule 24).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  lotoCheckpointsSettleBatchSchema,
  lotoCheckpointSettleSchema,
} from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";
import { SettlementVerification } from "../SettlementVerification";

const mockGetUnsettled = jest.fn();
const mockGetUncheckpointed = jest.fn();
const mockGetUnreimbursed = jest.fn();
const mockSettle = jest.fn();
const mockSettleBatch = jest.fn();
const mockCreateScheduled = jest.fn();

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  loto: {
    checkpoint: {
      getUnsettled: mockGetUnsettled,
      settle: mockSettle,
      settleBatch: mockSettleBatch,
      createScheduled: mockCreateScheduled,
    },
    getUncheckpointed: mockGetUncheckpointed,
    cashPrize: { getUnreimbursed: mockGetUnreimbursed },
  },
};

let stubLines: PaymentLine[] = [];
let lastPaymentTotals: Array<{ amount: number; currency: string }> = [];

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    MultiPaymentInput: (p: {
      onChange: (l: PaymentLine[]) => void;
      totals: Array<{ amount: number; currency: string }>;
    }) => {
      lastPaymentTotals = p.totals;
      return (
        <button type="button" onClick={() => p.onChange(stubLines)}>
          stub-pay
        </button>
      );
    },
  };
});

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90000, buyRate: 89000, isLoading: false }),
}));

const BUY_RATE = 89000;

function cp(
  id: number,
  sales: number,
  commission: number,
  cashPrizes: number,
): Record<string, number | string> {
  return {
    id,
    checkpoint_date: "2026-10-01",
    period_start: "2026-10-01",
    period_end: "2026-10-01",
    total_sales: sales,
    total_commission: commission,
    total_tickets: 1,
    total_prizes: 0,
    total_cash_prizes: cashPrizes,
    total_cash_prizes_count: cashPrizes > 0 ? 1 : 0,
    is_settled: 0,
  };
}

async function openDialog(): Promise<void> {
  render(<SettlementVerification />);
  fireEvent.click(screen.getByRole("button", { name: /settle/i }));
  await waitFor(() => expect(mockGetUnreimbursed).toHaveBeenCalled());
  await screen.findByText("stub-pay");
}

describe("SettlementVerification — settle-all posts the payment once", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubLines = [];
    lastPaymentTotals = [];
    mockGetUnreimbursed.mockResolvedValue({ success: true, prizes: [] });
    mockGetUncheckpointed.mockResolvedValue({ success: true, tickets: [] });
    mockSettle.mockResolvedValue({ success: true });
    mockSettleBatch.mockResolvedValue({ success: true, checkpoints: [] });
  });

  it("two checkpoints with opposite-sign nets → ONE settleBatch with the combined legs", async () => {
    // CP1 net = 0 - (1,000,000 - 44,500) = -955,500 (shop pays LOTO)
    // CP2 net = 500,000 - (100,000 - 4,450) = +404,450 (LOTO pays shop)
    // Combined net = -551,050 → the shop pays 551,050.
    mockGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [cp(1, 1_000_000, 44_500, 0), cp(2, 100_000, 4_450, 500_000)],
    });
    stubLines = [
      { id: "a", method: "CASH", currencyCode: "LBP", amount: 106_050 },
      { id: "b", method: "CASH", currencyCode: "USD", amount: 5 },
    ];

    await openDialog();
    expect(lastPaymentTotals).toEqual([{ amount: 551_050, currency: "LBP" }]);
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByRole("button", { name: /settle all \(2\)/i }));

    await waitFor(() => expect(mockSettleBatch).toHaveBeenCalledTimes(1));
    expect(mockSettle).not.toHaveBeenCalled();

    const parsed = lotoCheckpointsSettleBatchSchema.parse(
      mockSettleBatch.mock.calls[0][0],
    );
    expect(parsed.checkpointIds).toEqual([1, 2]);
    expect(parsed.totalSales).toBe(1_100_000);
    expect(parsed.totalCommission).toBe(48_950);
    expect(parsed.tender_exchange_rate).toBe(BUY_RATE);
    // Every leg points the way of the combined net (the shop pays → negative).
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "LBP", amount: -106_050 },
      { method: "CASH", currency_code: "USD", amount: -5 },
    ]);
  });

  it("settling with no payment lines still sends one batch call (no legs)", async () => {
    mockGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [cp(3, 200_000, 8_900, 0), cp(4, 300_000, 13_350, 0)],
    });

    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: /settle all \(2\)/i }));

    await waitFor(() => expect(mockSettleBatch).toHaveBeenCalledTimes(1));
    expect(mockSettle).not.toHaveBeenCalled();
    const parsed = lotoCheckpointsSettleBatchSchema.parse(
      mockSettleBatch.mock.calls[0][0],
    );
    expect(parsed.checkpointIds).toEqual([3, 4]);
    expect(parsed.payments ?? []).toEqual([]);
  });

  it("create-and-settle: legs follow the unchecked activity's sign and carry the rate", async () => {
    mockGetUnsettled.mockResolvedValue({ success: true, checkpoints: [] });
    // One 500,000 ticket, commission 22,250 → we pay LOTO 477,750.
    mockGetUncheckpointed.mockResolvedValue({
      success: true,
      tickets: [{ sale_amount: 500_000, commission_amount: 22_250 }],
    });
    mockCreateScheduled.mockResolvedValue({
      success: true,
      checkpoint: cp(9, 500_000, 22_250, 0),
    });
    stubLines = [
      { id: "a", method: "CASH", currencyCode: "LBP", amount: 477_750 },
    ];

    await openDialog();
    expect(lastPaymentTotals).toEqual([{ amount: 477_750, currency: "LBP" }]);
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(
      screen.getByRole("button", { name: /create checkpoint & settle/i }),
    );

    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    expect(mockSettleBatch).not.toHaveBeenCalled();
    const parsed = lotoCheckpointSettleSchema.parse(mockSettle.mock.calls[0][0]);
    expect(parsed.id).toBe(9);
    expect(parsed.tender_exchange_rate).toBe(BUY_RATE);
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "LBP", amount: -477_750 },
    ]);
  });
});

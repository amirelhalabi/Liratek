/** @jest-environment jsdom */

/**
 * LIRA-310 (US3, T045) — Waive on the LOTO settlement dialog.
 *
 *   - The shop owes LOTO 1,200,000 LBP and enters 1,000,000: "Settle All" is
 *     blocked (the missing underpaid gate). Waive on the Remaining row
 *     (the payment input's `onWaiveRemaining`) closes the 200,000 gap: the
 *     payment input's total drops to 1,000,000, Settle is enabled and the
 *     batch payload carries `discount_lbp: 200000` beside the 1,000,000 leg.
 *   - "Create Checkpoint & Settle" sends `discount_lbp` on the single settle.
 *   - Without a waive, no `discount_lbp` key is sent.
 *
 * Payloads are parsed through the core schemas (rule 24). The payment input
 * is a stub (same strategy as SettlementVerification.batchSettle.test.tsx);
 * `useApi` is one stable object (rule 25).
 * Rule 17: written before the change and run red — see tasks.md T045.
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
let stubWaive = 0;
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
      onWaiveRemaining?: (
        amount: number,
        byCcy: Array<{ currency: string; amount: number }>,
      ) => void;
    }) => {
      lastPaymentTotals = p.totals;
      return (
        <>
          <button type="button" onClick={() => p.onChange(stubLines)}>
            stub-pay
          </button>
          {p.onWaiveRemaining && (
            <button
              type="button"
              onClick={() =>
                p.onWaiveRemaining?.(stubWaive, [
                  { currency: "LBP", amount: stubWaive },
                ])
              }
            >
              stub-waive
            </button>
          )}
        </>
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

describe("SettlementVerification — LIRA-310 Waive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubLines = [];
    stubWaive = 0;
    lastPaymentTotals = [];
    mockGetUnreimbursed.mockResolvedValue({ success: true, prizes: [] });
    mockGetUncheckpointed.mockResolvedValue({ success: true, tickets: [] });
    mockSettle.mockResolvedValue({ success: true });
    mockSettleBatch.mockResolvedValue({ success: true, checkpoints: [] });
  });

  it("underpaid is blocked; Waive 200,000 → total drops, Settle enabled, batch sends discount_lbp", async () => {
    // net = 50,000 − 1,250,000 = −1,200,000 (the shop pays LOTO)
    mockGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [cp(1, 1_250_000, 50_000, 0)],
    });
    stubLines = [
      { id: "a", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
    ];
    stubWaive = 200_000;

    await openDialog();
    fireEvent.click(screen.getByText("stub-pay"));
    const settle = screen.getByRole("button", { name: /settle all \(1\)/i });
    await waitFor(() => expect(settle).toBeDisabled());

    fireEvent.click(screen.getByText("stub-waive"));
    await waitFor(() => expect(settle).not.toBeDisabled());
    expect(lastPaymentTotals).toEqual([{ amount: 1_000_000, currency: "LBP" }]);
    fireEvent.click(settle);

    await waitFor(() => expect(mockSettleBatch).toHaveBeenCalledTimes(1));
    const parsed = lotoCheckpointsSettleBatchSchema.parse(
      mockSettleBatch.mock.calls[0][0],
    );
    expect(parsed.discount_lbp).toBe(200_000);
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "LBP", amount: -1_000_000 },
    ]);
  });

  it("create-and-settle sends discount_lbp on the single settle", async () => {
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
      { id: "a", method: "CASH", currencyCode: "LBP", amount: 477_000 },
    ];
    stubWaive = 750;

    await openDialog();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-waive"));
    const btn = screen.getByRole("button", {
      name: /create checkpoint & settle/i,
    });
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);

    await waitFor(() => expect(mockSettle).toHaveBeenCalledTimes(1));
    const parsed = lotoCheckpointSettleSchema.parse(
      mockSettle.mock.calls[0][0],
    );
    expect(parsed.discount_lbp).toBe(750);
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "LBP", amount: -477_000 },
    ]);
  });

  it("a full payment sends no discount_lbp", async () => {
    mockGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [cp(1, 1_250_000, 50_000, 0)],
    });
    stubLines = [
      { id: "a", method: "CASH", currencyCode: "LBP", amount: 1_200_000 },
    ];
    await openDialog();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByRole("button", { name: /settle all \(1\)/i }));
    await waitFor(() => expect(mockSettleBatch).toHaveBeenCalledTimes(1));
    expect(mockSettleBatch.mock.calls[0][0]).not.toHaveProperty(
      "discount_lbp",
    );
  });
});

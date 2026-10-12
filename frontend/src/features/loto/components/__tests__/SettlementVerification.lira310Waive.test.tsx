/**
 * LIRA-310 (US3, T045) — Waive on the LOTO settlement dialog, under the
 * owner rule of 2026-10-12 (binding): "Waive only when money comes IN to
 * the shop and the payer hands over a little less than the total."
 *
 *   - LOTO owes the shop (net > 0, money IN) and pays 200,000 short:
 *     "Settle All" is blocked (underpaid gate); Waive on the Remaining row
 *     closes the gap, the payment total drops, Settle is enabled and the
 *     batch payload carries `discount_lbp: 200000`.
 *   - "Create Checkpoint & Settle" in the same direction sends
 *     `discount_lbp` on the single settle.
 *   - The shop owes LOTO (net < 0, money OUT) and pays short: NO Waive is
 *     offered, Settle stays blocked, and no `discount_lbp` is ever sent.
 *   - Without a waive, no `discount_lbp` key is sent.
 *
 * The payment input is a stub that mirrors the real component's gate: it
 * shows Waive only when `onWaiveRemaining` is given and `waiveDisabled` is
 * not set. `useApi` is one stable object (rule 25); payloads are parsed
 * through the core schemas (rule 24).
 * Rule 17: the direction guard was written before the change and run red.
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
      waiveDisabled?: boolean;
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
          {p.onWaiveRemaining && !p.waiveDisabled && (
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

describe("SettlementVerification — LIRA-310 Waive (money IN only)", () => {
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

  it("LOTO owes the shop, paid short: blocked; Waive 200,000 → total drops, Settle enabled, batch sends discount_lbp", async () => {
    // net = 2,400,000 − (1,250,000 − 50,000) = +1,200,000 (LOTO pays us)
    mockGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [cp(1, 1_250_000, 50_000, 2_400_000)],
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
      { method: "CASH", currency_code: "LBP", amount: 1_000_000 },
    ]);
  });

  it("create-and-settle (LOTO owes the shop) sends discount_lbp on the single settle", async () => {
    mockGetUnsettled.mockResolvedValue({ success: true, checkpoints: [] });
    // One 500,000 ticket (commission 22,250) and a 1,000,000 cash prize
    // not yet on a checkpoint → LOTO pays us 1,000,000 − 477,750 = 522,250.
    mockGetUncheckpointed.mockResolvedValue({
      success: true,
      tickets: [{ sale_amount: 500_000, commission_amount: 22_250 }],
    });
    mockGetUnreimbursed.mockResolvedValue({
      success: true,
      prizes: [{ prize_amount: 1_000_000, checkpoint_id: null }],
    });
    mockCreateScheduled.mockResolvedValue({
      success: true,
      checkpoint: cp(9, 500_000, 22_250, 1_000_000),
    });
    stubLines = [
      { id: "a", method: "CASH", currencyCode: "LBP", amount: 521_500 },
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
      { method: "CASH", currency_code: "LBP", amount: 521_500 },
    ]);
  });

  it("the shop owes LOTO, paid short: NO Waive, Settle stays blocked, no discount_lbp", async () => {
    // net = 50,000 − 1,250,000 = −1,200,000 (the shop pays LOTO)
    mockGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [cp(1, 1_250_000, 50_000, 0)],
    });
    stubLines = [
      { id: "a", method: "CASH", currencyCode: "LBP", amount: 1_198_000 },
    ];
    stubWaive = 2_000;

    await openDialog();
    fireEvent.click(screen.getByText("stub-pay"));
    const settle = screen.getByRole("button", { name: /settle all \(1\)/i });
    await waitFor(() => expect(settle).toBeDisabled());
    expect(screen.queryByText("stub-waive")).not.toBeInTheDocument();
    expect(screen.getByTestId("loto-settle-underpaid")).toBeInTheDocument();
    expect(lastPaymentTotals).toEqual([{ amount: 1_200_000, currency: "LBP" }]);
    expect(mockSettleBatch).not.toHaveBeenCalled();
  });

  it("a full payment to LOTO sends no discount_lbp", async () => {
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
    expect(mockSettleBatch.mock.calls[0][0]).not.toHaveProperty("discount_lbp");
  });
});

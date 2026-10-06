/** @jest-environment jsdom */

/**
 * LIRA-185 loto lead 7 — the Settlement dialog's "Unchecked Activity" panel
 * must show exactly what the next checkpoint will sweep: tickets with no
 * checkpoint yet, voided tickets excluded. That set is the server's
 * `getUncheckpointed()` read (checkpoint_id IS NULL + not refunded) — the
 * same read the page's own Checkpoint button uses.
 *
 * The old panel re-derived the set with `getByDateRange(lastPeriodEnd + 1,
 * today)`, which (A) is an inverted, empty range right after a checkpoint
 * taken today, so a ticket sold after it vanished from the panel, and (B) is
 * not refund-gated, so a voided ticket inflated "We pay LOTO" (955,500 vs
 * 477,750 LBP for two 500,000 tickets, one voided).
 *
 * The `getByDateRange` mock below returns what that read really returns in
 * each case (measured in core's ProfitAudit.loto.test.ts, lead 7), so the
 * old code path renders the wrong figure here.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettlementVerification } from "../SettlementVerification";

const mockCheckpointGetUnsettled = jest.fn();
const mockCheckpointGetLast = jest.fn();
const mockGetByDateRange = jest.fn();
const mockGetUncheckpointed = jest.fn();
const mockCashPrizeGetUnreimbursed = jest.fn();

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  loto: {
    checkpoint: {
      getUnsettled: mockCheckpointGetUnsettled,
      getLast: mockCheckpointGetLast,
    },
    getByDateRange: mockGetByDateRange,
    getUncheckpointed: mockGetUncheckpointed,
    cashPrize: {
      getUnreimbursed: mockCashPrizeGetUnreimbursed,
    },
  },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

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
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

function ticket(sale: number, commission: number) {
  return { sale_amount: sale, commission_amount: commission };
}

async function openDialog(): Promise<void> {
  render(<SettlementVerification />);
  fireEvent.click(screen.getByRole("button", { name: /settle/i }));
  await waitFor(() =>
    expect(mockCashPrizeGetUnreimbursed).toHaveBeenCalled(),
  );
}

describe("SettlementVerification — Unchecked Activity reads the checkpoint sweep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckpointGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [],
    });
    mockCashPrizeGetUnreimbursed.mockResolvedValue({
      success: true,
      prizes: [],
    });
  });

  it("case A: a ticket sold after today's checkpoint shows as pending", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockCheckpointGetLast.mockResolvedValue({
      success: true,
      checkpoint: { id: 1, period_end: today },
    });
    // (today + 1, today) is an empty range.
    mockGetByDateRange.mockResolvedValue({ success: true, tickets: [] });
    mockGetUncheckpointed.mockResolvedValue({
      success: true,
      tickets: [ticket(300000, 13350)],
    });

    await openDialog();

    expect(await screen.findByText("Unchecked Activity")).toBeTruthy();
    expect(screen.getByText(/1 ticket/)).toBeTruthy();
    // LIRA-258: the payment input now also asks for this same amount (it
    // used to show 0 with no checkpoint yet), so the figure appears more
    // than once — both read the same unchecked-activity net.
    expect(
      screen.getAllByText(new RegExp((300000 - 13350).toLocaleString())).length,
    ).toBeGreaterThan(0);
  });

  it("case B: a voided ticket does not inflate 'We pay LOTO'", async () => {
    mockCheckpointGetLast.mockResolvedValue({ success: true, checkpoint: null });
    // The date-range read is not refund-gated: both tickets come back.
    mockGetByDateRange.mockResolvedValue({
      success: true,
      tickets: [ticket(500000, 22250), ticket(500000, 22250)],
    });
    mockGetUncheckpointed.mockResolvedValue({
      success: true,
      tickets: [ticket(500000, 22250)],
    });

    await openDialog();

    expect(await screen.findByText("We pay LOTO")).toBeTruthy();
    // See case A: the payment input shows the same net too (LIRA-258).
    expect(
      screen.getAllByText(new RegExp((477750).toLocaleString())).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(new RegExp((955500).toLocaleString()))).toBeNull();
  });

  it("never re-derives the pending set from a date range", async () => {
    mockCheckpointGetLast.mockResolvedValue({ success: true, checkpoint: null });
    mockGetByDateRange.mockResolvedValue({ success: true, tickets: [] });
    mockGetUncheckpointed.mockResolvedValue({ success: true, tickets: [] });

    await openDialog();

    expect(mockGetUncheckpointed).toHaveBeenCalled();
    expect(mockGetByDateRange).not.toHaveBeenCalled();
  });
});

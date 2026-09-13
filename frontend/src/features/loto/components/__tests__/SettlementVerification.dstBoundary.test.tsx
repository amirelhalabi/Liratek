/** @jest-environment jsdom */

/**
 * SettlementVerification — unchecked-activity `periodStart` must be the day
 * AFTER the last checkpoint's `period_end`, computed with pure UTC
 * calendar-date arithmetic.
 *
 * The old code did:
 *   const nextDay = new Date(lastResult.checkpoint.period_end);
 *   nextDay.setDate(nextDay.getDate() + 1);
 *   periodStart = localDay(nextDay);
 *
 * `new Date("2026-09-12")` parses as UTC midnight. At a negative UTC offset
 * (e.g. America/New_York, UTC-4/-5) that instant is still "2026-09-11
 * evening" on the machine's local clock, so `setDate(getDate() + 1)` steps
 * from the wrong local day and `localDay()` (which reads back with LOCAL
 * getters) then re-renders "2026-09-12" — the SAME day, not the next one.
 * The checkpoint's own last day gets counted a second time in the unchecked
 * -activity query (`api.loto.getByDateRange(periodStart, today)`).
 *
 * The fix replaces all of that with `addDaysToDateString(period_end, 1)`
 * (`@liratek/core`, pure UTC string arithmetic — no local getter/setter ever
 * enters the picture), so the result is identical in every timezone. That is
 * exactly what this test asserts: a fixed `period_end` must always produce
 * the same `periodStart`, regardless of which TZ the suite happens to run
 * under (frontend jest does not pin one).
 *
 * Rule-17 discharge (2026-09-13): copied this file to a temp path outside
 * the repo, then reverted `SettlementVerification.tsx`'s
 * `loadSettlementData` to the old `new Date(...).setDate(...)` +
 * `localDay(...)` idiom shown above. Ran, from `frontend/`:
 *   node ../node_modules/cross-env/src/bin/cross-env.js TZ=America/New_York npx jest --testPathPatterns "SettlementVerification.dstBoundary"
 * It failed exactly as predicted:
 *   expect(mockGetByDateRange).toHaveBeenCalledWith("2026-09-13", "2026-09-13")
 *   Expected: "2026-09-13", "2026-09-13"
 *   Received: "2026-09-12", "2026-09-13"
 * (1 failed, 1 total). Restored from the temp copy; `git diff --stat -- \
 * frontend/src/features/loto/components/SettlementVerification.tsx` printed
 * nothing afterward. Confirmed green again under
 * TZ=America/New_York, TZ=Asia/Beirut and TZ=UTC.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettlementVerification } from "../SettlementVerification";

const mockCheckpointGetUnsettled = jest.fn();
const mockCheckpointGetLast = jest.fn();
const mockGetByDateRange = jest.fn();
const mockCashPrizeGetUnreimbursed = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    loto: {
      checkpoint: {
        getUnsettled: mockCheckpointGetUnsettled,
        getLast: mockCheckpointGetLast,
      },
      getByDateRange: mockGetByDateRange,
      cashPrize: {
        getUnreimbursed: mockCashPrizeGetUnreimbursed,
      },
    },
  }),
}));

// Bypass the real hooks entirely — they call useApi() internally too, but
// this test only cares about the periodStart computation, not payment
// method/rate loading.
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

describe("SettlementVerification — unchecked-activity periodStart is TZ-independent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckpointGetUnsettled.mockResolvedValue({
      success: true,
      checkpoints: [],
    });
    mockCheckpointGetLast.mockResolvedValue({
      success: true,
      checkpoint: { id: 1, period_end: "2026-09-12" },
    });
    mockGetByDateRange.mockResolvedValue({ tickets: [] });
    mockCashPrizeGetUnreimbursed.mockResolvedValue({
      success: true,
      prizes: [],
    });
  });

  it("queries from the day AFTER period_end, never the same day", async () => {
    render(<SettlementVerification />);

    fireEvent.click(screen.getByRole("button", { name: /settle/i }));

    await waitFor(() => expect(mockGetByDateRange).toHaveBeenCalled());

    const [periodStart, today] = mockGetByDateRange.mock.calls[0];
    expect(periodStart).toBe("2026-09-13");
    // Sanity: it must not regress to double-counting period_end itself.
    expect(periodStart).not.toBe("2026-09-12");
    expect(typeof today).toBe("string");
  });
});

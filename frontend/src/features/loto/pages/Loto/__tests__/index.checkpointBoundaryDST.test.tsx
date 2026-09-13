/** @jest-environment jsdom */

/**
 * LotoPage `handleCreateCheckpoint` — the manual "Checkpoint" button's
 * `period_start` must be the day AFTER the last checkpoint's `period_end`,
 * computed with pure UTC calendar-date arithmetic. Byte-identical bug (and
 * fix) to `SettlementVerification.dstBoundary.test.tsx` — see that file for
 * the full mechanism writeup; this one proves the SECOND copy of the same
 * idiom, in `handleCreateCheckpoint` (`frontend/src/features/loto/pages/Loto/index.tsx`),
 * independently.
 *
 * The old code:
 *   const nextDay = new Date(lastResult.checkpoint.period_end);
 *   nextDay.setDate(nextDay.getDate() + 1);
 *   periodStart = localDay(nextDay);
 * mixes UTC parsing (`new Date("YYYY-MM-DD")`) with LOCAL stepping/reading
 * (`setDate`/`getDate` via `localDay`), so at a negative UTC offset the
 * result is the SAME day as `period_end`, not the next one — the manual
 * checkpoint's period would silently overlap the previous one by a day.
 *
 * The fix is `addDaysToDateString(period_end, 1)` (`@liratek/core`, pure UTC
 * string arithmetic) — identical output in every timezone, which is exactly
 * what this test asserts (frontend jest does not pin a TZ).
 *
 * All child components/hooks not relevant to `handleCreateCheckpoint` are
 * stubbed out to isolate the one code path under test; none of them
 * participate in the periodStart computation.
 *
 * Rule-17 discharge (2026-09-13): copied this file to a temp path outside
 * the repo, then reverted `LotoPage`'s `handleCreateCheckpoint` (and removed
 * the now-unused `addDaysToDateString` import, else ts-jest fails the whole
 * suite on TS6133 before the assertion ever runs) to the old
 * `new Date(...).setDate(...)` + `localDay(...)` idiom. Ran, from
 * `frontend/`:
 *   node ../node_modules/cross-env/src/bin/cross-env.js TZ=America/New_York npx jest --testPathPatterns "index.checkpointBoundaryDST"
 * It failed exactly as predicted:
 *   expect(mockCheckpointCreate).toHaveBeenCalledWith(
 *     expect.objectContaining({ period_start: "2026-09-13" }),
 *   )
 *   Expected: ObjectContaining {"period_start": "2026-09-13"}
 *   Received: {"checkpoint_date": "2026-09-13", "note": ..., "period_end": "2026-09-13", "period_start": "2026-09-12"}
 * (1 failed, 1 total). Restored from the temp copy; `git diff --stat -- \
 * frontend/src/features/loto/pages/Loto/index.tsx` printed nothing
 * afterward. Confirmed green again under TZ=America/New_York, TZ=Asia/Beirut
 * and TZ=UTC.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LotoPage } from "../index";

const mockLotoSettingsGet = jest.fn();
const mockLotoReport = jest.fn();
const mockCheckpointGetLast = jest.fn();
const mockGetUncheckpointed = jest.fn();
const mockCashPrizeGetTotalUnreimbursed = jest.fn();
const mockCheckpointCreate = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    loto: {
      settings: { get: mockLotoSettingsGet },
      report: mockLotoReport,
      checkpoint: {
        getLast: mockCheckpointGetLast,
        create: mockCheckpointCreate,
      },
      getUncheckpointed: mockGetUncheckpointed,
      cashPrize: { getTotalUnreimbursed: mockCashPrizeGetTotalUnreimbursed },
    },
  }),
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
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

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null, addToCart: jest.fn() }),
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn(),
}));

jest.mock("@/features/recharge/utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn(),
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
}));

// Relative to THIS file (pages/Loto/__tests__/), not to index.tsx.
jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => null,
}));
jest.mock("../../../components/CheckpointHistory", () => ({
  CheckpointHistory: () => null,
}));
jest.mock("../../../components/TicketHistoryModal", () => ({
  TicketHistoryModal: () => null,
}));
jest.mock("../../../components/CheckpointScheduler", () => ({
  CheckpointScheduler: () => null,
}));
jest.mock("../../../components/SettlementVerification", () => ({
  SettlementVerification: () => null,
}));

describe("LotoPage — manual checkpoint period_start is TZ-independent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLotoSettingsGet.mockResolvedValue({ success: false });
    mockLotoReport.mockResolvedValue({ success: false });
    mockCheckpointGetLast.mockResolvedValue({
      success: true,
      checkpoint: { id: 1, period_end: "2026-09-12" },
    });
    mockGetUncheckpointed.mockResolvedValue({
      tickets: [{ id: 1, sale_amount: 100000 }],
    });
    mockCashPrizeGetTotalUnreimbursed.mockResolvedValue({
      success: true,
      total: 0,
    });
    mockCheckpointCreate.mockResolvedValue({ success: true });
  });

  it("creates the checkpoint starting from the day AFTER period_end, never the same day", async () => {
    render(<LotoPage />);

    fireEvent.click(screen.getByRole("button", { name: /checkpoint/i }));

    await waitFor(() => expect(mockCheckpointCreate).toHaveBeenCalled());

    const payload = mockCheckpointCreate.mock.calls[0][0];
    expect(payload.period_start).toBe("2026-09-13");
    // Sanity: it must not regress to double-counting period_end itself.
    expect(payload.period_start).not.toBe("2026-09-12");
  });
});

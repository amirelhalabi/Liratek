// electron-app/handlers/__tests__/closingDifferenceHandlers.test.ts
//
// LIRA-335 (T023) — the three checkpoint-difference IPC channels and the
// `open_only` filter on the existing timeline read. Same mocking style as
// `closingHandlers.test.ts`: `@liratek/core` via requireActual + override,
// session and audit mocked wholesale, `ipcMain.handle` captured into a Map.
//
// Rule 17: written before the channels existed and run against the unfixed
// handlers (the registration assertion is the first to fail).

import { ipcMain } from "electron";
import { registerDatabaseHandlers } from "../dbHandlers";
import { getClosingService } from "@liratek/core";
import { requireRole } from "../../session";
import { audit } from "../auditHelper";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
  app: { getPath: jest.fn(() => "/tmp"), isPackaged: false },
  dialog: { showOpenDialog: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSettingsService: jest.fn(() => ({
      getAllSettings: jest.fn(),
      getSettingValue: jest.fn(),
      updateSetting: jest.fn(),
    })),
    getExpenseService: jest.fn(() => ({
      addExpense: jest.fn(),
      getTodayExpenses: jest.fn(),
      deleteExpense: jest.fn(),
      updateExpenseMetadata: jest.fn(),
    })),
    getActivityService: jest.fn(() => ({
      getSyncErrors: jest.fn(),
      getRecentLogs: jest.fn(),
    })),
    getClosingService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

const CHANNELS = [
  "closing:get-open-differences-after",
  "closing:close-difference",
  "closing:reopen-difference",
] as const;

/** A difference as the core view returns it (contracts/api.md), carrying
 *  user names in both places the staff payload must not show them. */
function makeDifference() {
  return {
    id: 7,
    closing_id: 3,
    closing_created_at: "2026-10-18 18:00:00",
    drawer_name: "General",
    currency_code: "USD",
    amount: -50,
    direction: "SHORT",
    resolved: 20,
    open: 30,
    status: "PARTLY_RESOLVED",
    closed_at: "2026-10-18 19:00:00",
    closed_by_name: "OwnerAlice",
    shortage_expense_id: null,
    resolutions: [
      {
        transaction_id: 99,
        transaction_type: "SALE",
        summary: "Sale #99",
        amount: -20,
        effective_time: "2026-10-18 17:30:00",
        entered_at: "2026-10-18 18:30:00",
        user_name: "CashierBob",
      },
    ],
  };
}

describe("LIRA-335 checkpoint-difference IPC handlers", () => {
  let mockClosingService: {
    getCheckpointTimeline: jest.Mock;
    getOpenDifferencesAfter: jest.Mock;
    closeCheckpointDifference: jest.Mock;
    reopenCheckpointDifference: jest.Mock;
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  const asAdmin = () =>
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "admin",
      userId: 1,
    });
  const asStaff = () =>
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "staff",
      userId: 5,
    });
  const refused = () =>
    (requireRole as jest.Mock).mockReturnValue({
      ok: false,
      error: "Forbidden",
    });

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();
    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });
    mockClosingService = {
      getCheckpointTimeline: jest.fn(),
      getOpenDifferencesAfter: jest.fn(),
      closeCheckpointDifference: jest.fn(),
      reopenCheckpointDifference: jest.fn(),
    };
    (getClosingService as jest.Mock).mockReturnValue(mockClosingService);
    asAdmin();
    registerDatabaseHandlers();
  });

  const call = (channel: string, ...args: unknown[]) =>
    handlers.get(channel)!({ sender: { id: 1 } }, ...args);

  it("registers the three new channels", () => {
    for (const channel of CHANNELS) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  describe("closing:get-open-differences-after", () => {
    const CH = "closing:get-open-differences-after";

    it("allows admin and staff (the hint shows on cashier forms)", async () => {
      mockClosingService.getOpenDifferencesAfter.mockReturnValue({
        success: true,
        data: [],
      });
      await call(CH, { at: "2026-10-18 17:00:00" });
      expect(requireRole).toHaveBeenLastCalledWith(1, ["admin", "staff"]);
    });

    it("refuses an unauthenticated caller and never reaches the service", async () => {
      refused();
      const res = await call(CH, { at: "2026-10-18 17:00:00" });
      expect(res).toEqual({ success: false, error: "Forbidden" });
      expect(mockClosingService.getOpenDifferencesAfter).not.toHaveBeenCalled();
    });

    it("refuses a missing `at` before the service", async () => {
      const res = (await call(CH, {})) as { success: boolean };
      expect(res.success).toBe(false);
      expect(mockClosingService.getOpenDifferencesAfter).not.toHaveBeenCalled();
    });

    it("returns the full view to admin", async () => {
      const diff = makeDifference();
      mockClosingService.getOpenDifferencesAfter.mockReturnValue({
        success: true,
        data: [diff],
      });
      const res = await call(CH, { at: "2026-10-18 17:00:00" });
      expect(mockClosingService.getOpenDifferencesAfter).toHaveBeenCalledWith({
        at: "2026-10-18 17:00:00",
      });
      expect(res).toEqual({ success: true, data: [diff] });
    });

    it("blanks resolutions and closed_by_name for staff (no user names)", async () => {
      asStaff();
      mockClosingService.getOpenDifferencesAfter.mockReturnValue({
        success: true,
        data: [makeDifference()],
      });
      const res = (await call(CH, { at: "2026-10-18 17:00:00" })) as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].resolutions).toEqual([]);
      expect(res.data[0].closed_by_name).toBeNull();
      // Everything the hint needs survives.
      expect(res.data[0]).toEqual(
        expect.objectContaining({
          drawer_name: "General",
          currency_code: "USD",
          open: 30,
          closing_created_at: "2026-10-18 18:00:00",
        }),
      );
      const text = JSON.stringify(res);
      expect(text).not.toContain("OwnerAlice");
      expect(text).not.toContain("CashierBob");
    });

    it("returns the envelope when the service throws", async () => {
      mockClosingService.getOpenDifferencesAfter.mockImplementation(() => {
        throw new Error("boom");
      });
      const res = await call(CH, { at: "2026-10-18 17:00:00" });
      expect(res).toEqual({ success: false, error: "boom" });
    });
  });

  describe.each([
    {
      channel: "closing:close-difference",
      method: "closeCheckpointDifference" as const,
      action: "close_checkpoint_difference",
    },
    {
      channel: "closing:reopen-difference",
      method: "reopenCheckpointDifference" as const,
      action: "reopen_checkpoint_difference",
    },
  ])("$channel", ({ channel, method, action }) => {
    it("is admin-only: staff is refused and the service is never reached", async () => {
      refused();
      const res = await call(channel, { difference_id: 7 });
      expect(requireRole).toHaveBeenLastCalledWith(1, ["admin"]);
      expect(res).toEqual({ success: false, error: "Forbidden" });
      expect(mockClosingService[method]).not.toHaveBeenCalled();
    });

    it("validates difference_id", async () => {
      for (const bad of [{}, { difference_id: 0 }, { difference_id: "7" }]) {
        const res = (await call(channel, bad)) as { success: boolean };
        expect(res.success).toBe(false);
      }
      expect(mockClosingService[method]).not.toHaveBeenCalled();
    });

    it("injects userId from the session, never the client, and audits on success", async () => {
      const diff = makeDifference();
      mockClosingService[method].mockReturnValue({ success: true, data: diff });
      const res = await call(channel, { difference_id: 7, userId: 999 });
      expect(mockClosingService[method]).toHaveBeenCalledWith({
        difference_id: 7,
        userId: 1,
      });
      expect(res).toEqual({ success: true, data: diff });
      expect(audit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          action,
          entity_type: "checkpoint_differences",
          entity_id: "7",
        }),
      );
    });

    it("does not audit a refused write", async () => {
      mockClosingService[method].mockReturnValue({
        success: false,
        error: "Already closed",
      });
      const res = await call(channel, { difference_id: 7 });
      expect(res).toEqual({ success: false, error: "Already closed" });
      expect(audit).not.toHaveBeenCalled();
    });

    it("returns the envelope when the service throws", async () => {
      mockClosingService[method].mockImplementation(() => {
        throw new Error("db gone");
      });
      const res = await call(channel, { difference_id: 7 });
      expect(res).toEqual({ success: false, error: "db gone" });
    });
  });

  describe("closing:getCheckpointTimeline", () => {
    it("passes open_only through to the service", async () => {
      mockClosingService.getCheckpointTimeline.mockReturnValue({
        success: true,
        checkpoints: [],
        open_count: 0,
      });
      const res = await call("closing:getCheckpointTimeline", {
        open_only: true,
        drawer_name: "General",
      });
      expect(mockClosingService.getCheckpointTimeline).toHaveBeenCalledWith(
        expect.objectContaining({ open_only: true, drawer_name: "General" }),
      );
      expect(res).toEqual({ success: true, checkpoints: [], open_count: 0 });
    });
  });
});

// electron-app/handlers/__tests__/closingHandlers.test.ts
//
// REVIVED 2026-09-13.
//
// Root cause #1 — this suite could NEVER have passed as originally written,
// not merely regressed. It used the factory-less automock form
// (`jest.mock("electron");` / `jest.mock("../../db");`), which asks Jest to
// substitute a MANUAL mock from a `__mocks__` directory. No `__mocks__`
// directory exists anywhere in `electron-app` (checked before writing this),
// so both calls resolved to `undefined`, and the very first line of
// `beforeEach` — `(ipcMain.handle as any).mockClear?.()` — threw
// "Cannot read properties of undefined (reading 'handle')" before a single
// assertion ran. Every other suite in this folder supplies an inline
// factory (`jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }))`)
// instead; this was the one file that didn't, and it is rewritten below to
// match that (and this folder's newer, `@liratek/core`-aware) pattern.
//
// Root cause #2 — even with the mock fixed, the two channel names this
// suite asserted, "closing:set-opening-balances" and
// "closing:create-daily-closing", no longer exist ANYWHERE in the codebase
// (grepped: zero hits outside this file and the two stale
// dbHandlers.test.ts / dbHandlers_registration.test.ts siblings, which
// assert the same dead names and are owned by a different pass). The
// "closing" IPC surface was overhauled to a checkpoint model: recording an
// opening/starting balance is now `closing:create-checkpoint`, and there is
// no longer a standalone "create daily closing" call — a `daily_closings`
// row is created as a side effect of the checkpoint flow and is only ever
// patched afterward via `closing:update-daily-closing`. Rewritten against
// the CURRENT contract (see `../dbHandlers.ts`'s "==================== CLOSING
// ====================" section), preserving the original intent (closing
// is money-adjacent — cover registration AND role-gated
// validation/behavior, not just a channel-name smoke test).
//
// Mocking style mirrors `debtHandlers.test.ts` / `authHandlers.sessions.test.ts`
// / `exchangeLotHandlers.test.ts` in this folder: `@liratek/core` mocked via
// `jest.requireActual` + override (real schemas/services elsewhere in the
// module survive; only the getters `registerDatabaseHandlers` actually calls
// are replaced with mocks), `../../session` and `../auditHelper` mocked
// wholesale, `ipcMain.handle` captured into a Map so each channel's handler
// can be invoked directly with a fake `{ sender: { id } }` event.

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
    // registerDatabaseHandlers() calls these three eagerly, at registration
    // time (not lazily inside a handler) — they MUST be stubbed or
    // registration would reach through to a real, unconnected database.
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
    // getClosingService() is resolved lazily inside each closing handler
    // body, so mocking it here just makes it swappable per-test below.
    getClosingService: jest.fn(),
  };
});

jest.mock("../../session", () => ({
  requireRole: jest.fn(),
}));

jest.mock("../auditHelper", () => ({
  audit: jest.fn(),
}));

describe("Closing Handlers (registerDatabaseHandlers' CLOSING section)", () => {
  let mockClosingService: {
    createCheckpoint: jest.Mock;
    updateDailyClosing: jest.Mock;
    hasOpeningBalanceToday: jest.Mock;
    hasInitialBalancesSet: jest.Mock;
    hasStartingCheckpoint: jest.Mock;
    getInitialCheckpointDate: jest.Mock;
    getLastCheckpointActuals: jest.Mock;
    getLastCheckpointPerDrawer: jest.Mock;
    getCheckpointTimeline: jest.Mock;
    recalculateDrawerBalances: jest.Mock;
    getSystemExpectedBalancesDynamic: jest.Mock;
    getDailyStatsSnapshot: jest.Mock;
  };
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = new Map();

    (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    mockClosingService = {
      createCheckpoint: jest.fn(),
      updateDailyClosing: jest.fn(),
      hasOpeningBalanceToday: jest.fn(),
      hasInitialBalancesSet: jest.fn(),
      hasStartingCheckpoint: jest.fn(),
      getInitialCheckpointDate: jest.fn(),
      getLastCheckpointActuals: jest.fn(),
      getLastCheckpointPerDrawer: jest.fn(),
      getCheckpointTimeline: jest.fn(),
      recalculateDrawerBalances: jest.fn(),
      getSystemExpectedBalancesDynamic: jest.fn(),
      getDailyStatsSnapshot: jest.fn(),
    };
    (getClosingService as jest.Mock).mockReturnValue(mockClosingService);

    // Default: authenticated admin. Individual tests override where the
    // role gate itself is the point.
    (requireRole as jest.Mock).mockReturnValue({
      ok: true,
      role: "admin",
      userId: 1,
    });

    registerDatabaseHandlers();
  });

  it("registers every current closing IPC channel", () => {
    const calls = (ipcMain.handle as jest.Mock).mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        "closing:create-checkpoint",
        "closing:update-daily-closing",
        "closing:get-system-expected-balances-dynamic",
        "closing:get-daily-stats-snapshot",
        "closing:getCheckpointTimeline",
        "closing:recalculate-drawer-balances",
        "closing:get-last-checkpoint-actuals",
        "closing:get-last-checkpoint-per-drawer",
        "closing:has-opening-balance-today",
        "closing:has-initial-balances-set",
        "closing:has-starting-checkpoint",
        "closing:get-initial-checkpoint-date",
      ]),
    );
  });

  describe("closing:create-checkpoint", () => {
    it("is admin-gated: refuses and never reaches the service when requireRole fails", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Forbidden",
      });
      const handler = handlers.get("closing:create-checkpoint")!;

      const result = await handler(
        { sender: { id: 1 } },
        { user_id: 1, drawer_name: "General", amounts: [] },
      );

      expect(result).toEqual({ success: false, error: "Forbidden" });
      expect(mockClosingService.createCheckpoint).not.toHaveBeenCalled();
    });

    it("creates the checkpoint via the service and audits on success", async () => {
      mockClosingService.createCheckpoint.mockReturnValue({
        success: true,
        id: 42,
      });
      const handler = handlers.get("closing:create-checkpoint")!;
      const data = {
        user_id: 1,
        drawer_name: "General",
        amounts: [
          {
            drawer_name: "General",
            currency_code: "USD",
            expected_amount: 100,
            physical_amount: 100,
          },
        ],
      };

      const result = await handler({ sender: { id: 1 } }, data);

      expect(mockClosingService.createCheckpoint).toHaveBeenCalledWith(data);
      expect(result).toEqual({ success: true, id: 42 });
      expect(audit).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          action: "create_checkpoint",
          entity_type: "daily_closings",
          entity_id: "42",
        }),
      );
    });

    it("does not audit when the service reports failure", async () => {
      mockClosingService.createCheckpoint.mockReturnValue({
        success: false,
        error: "Amounts required",
      });
      const handler = handlers.get("closing:create-checkpoint")!;

      const result = await handler(
        { sender: { id: 1 } },
        { user_id: 1, drawer_name: "General", amounts: [] },
      );

      expect(result).toEqual({ success: false, error: "Amounts required" });
      expect(audit).not.toHaveBeenCalled();
    });

    it("catches a thrown service error into the standard envelope", async () => {
      mockClosingService.createCheckpoint.mockImplementation(() => {
        throw new Error("DB locked");
      });
      const handler = handlers.get("closing:create-checkpoint")!;

      const result = await handler(
        { sender: { id: 1 } },
        { user_id: 1, drawer_name: "General", amounts: [] },
      );

      expect(result).toEqual({ success: false, error: "DB locked" });
    });
  });

  describe("closing:update-daily-closing", () => {
    it("allows staff (not just admin) and forwards to the service", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: true,
        role: "staff",
        userId: 7,
      });
      mockClosingService.updateDailyClosing.mockReturnValue({
        success: true,
      });
      const handler = handlers.get("closing:update-daily-closing")!;
      const data = { id: 42, physical_usd: 105 };

      const result = await handler({ sender: { id: 7 } }, data);

      expect(mockClosingService.updateDailyClosing).toHaveBeenCalledWith(data);
      expect(result).toEqual({ success: true });
      expect(audit).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          action: "update",
          entity_type: "daily_closings",
          entity_id: "42",
        }),
      );
    });

    it("refuses a role outside admin/staff without calling the service", async () => {
      (requireRole as jest.Mock).mockReturnValue({
        ok: false,
        error: "Forbidden",
      });
      const handler = handlers.get("closing:update-daily-closing")!;

      const result = await handler({ sender: { id: 3 } }, { id: 42 });

      expect(result).toEqual({ success: false, error: "Forbidden" });
      expect(mockClosingService.updateDailyClosing).not.toHaveBeenCalled();
    });
  });

  describe("closing:has-opening-balance-today", () => {
    it("requires no auth and forwards the client's local day to the service", async () => {
      mockClosingService.hasOpeningBalanceToday.mockReturnValue(true);
      const handler = handlers.get("closing:has-opening-balance-today")!;

      const result = await handler({ sender: { id: 1 } }, "2026-09-13");

      expect(mockClosingService.hasOpeningBalanceToday).toHaveBeenCalledWith(
        "2026-09-13",
      );
      expect(result).toBe(true);
      expect(requireRole).not.toHaveBeenCalled();
    });

    it("fails safe to false (not a throw) when the service errors", async () => {
      mockClosingService.hasOpeningBalanceToday.mockImplementation(() => {
        throw new Error("DB error");
      });
      const handler = handlers.get("closing:has-opening-balance-today")!;

      const result = await handler({ sender: { id: 1 } }, undefined);

      expect(result).toBe(false);
    });
  });
});

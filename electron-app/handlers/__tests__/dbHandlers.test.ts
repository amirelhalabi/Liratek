// electron/handlers/__tests__/dbHandlers.test.ts

/**
 * Revived 2026-09-13 (rotted test suite).
 *
 * What had drifted: this suite mocked `../../db`'s `getDatabase()` and drove
 * `closing:get-system-expected-balances` / `closing:create-daily-closing`
 * through hand-rolled `db.prepare(...).get()/.run()` fixtures — the SQL
 * layer these handlers used to own directly before the service split
 * (CLAUDE.md rule 13). Neither channel exists in `dbHandlers.ts` in that
 * form any more:
 *
 *   - `closing:get-system-expected-balances` (fixed
 *     generalDrawer/omtDrawer/whishDrawer/... shape) was replaced by
 *     `closing:get-system-expected-balances-dynamic`, a thin delegate to
 *     `ClosingService.getSystemExpectedBalancesDynamic()` returning
 *     `Record<drawerName, Record<currencyCode, balance>>`. Renamed and
 *     rewritten below to mock the service instead of the database.
 *
 *   - `closing:create-daily-closing` is GONE from the IPC surface entirely —
 *     `backend/src/api/closing.ts`'s `POST /daily-closing` route comment
 *     states outright "createDailyClosing is never called from any
 *     electron-app handler"; it is REST-only now
 *     (`ClosingService.createDailyClosing`, a legacy shim over
 *     `createCheckpoint`). The desktop equivalent of "create a closing" is
 *     the materially different, admin-gated `closing:create-checkpoint`
 *     channel (drawer_name/user_id/amounts/carrier_lines, audited). Rather
 *     than bolt a same-name-different-contract test onto this file, the
 *     `closing:create-daily-closing` registration assertion and its two
 *     behavior tests are DELETED — there is nothing left in `dbHandlers.ts`
 *     for them to exercise, and inventing coverage for
 *     `closing:create-checkpoint` under this file's stale name would misname
 *     what's being tested.
 *
 *   - `closing:get-daily-stats-snapshot` still exists but is now a thin
 *     delegate to `ClosingService.getDailyStatsSnapshot()`. The
 *     null-coalescing this test used to drive via raw SQL-row fixtures now
 *     lives in `ClosingRepository`, not the handler — rewritten as a
 *     verbatim-passthrough test (the handler adds no defaulting of its own).
 *
 * Mocks now target `@liratek/core`'s service getters (jest.requireActual +
 * override), matching `exchangeLotHandlers.test.ts` / `debtHandlers.test.ts`,
 * instead of a `../../db` module `dbHandlers.ts` no longer imports at module
 * scope.
 */

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
  app: { getPath: jest.fn(() => "/tmp"), isPackaged: false },
  dialog: { showOpenDialog: jest.fn() },
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core");
  return {
    ...actual,
    getSettingsService: jest.fn(),
    getExpenseService: jest.fn(),
    getClosingService: jest.fn(),
    getActivityService: jest.fn(),
    getUserRepository: jest.fn(),
  };
});

jest.mock("../../session.js", () => ({
  requireRole: jest.fn(() => ({ ok: true, userId: 7 })),
}));

jest.mock("../auditHelper.js", () => ({
  audit: jest.fn(),
}));

import { ipcMain as originalIpcMain } from "electron";
import {
  getSettingsService,
  getExpenseService,
  getClosingService,
  getActivityService,
  getUserRepository,
} from "@liratek/core";
import { registerDatabaseHandlers } from "../dbHandlers";

const ipcMain = originalIpcMain as unknown as {
  handle: jest.Mock;
  on: jest.Mock;
  removeHandler: jest.Mock;
};

describe("dbHandlers IPC: Closing functionality", () => {
  const mockClosingService = {
    getSystemExpectedBalancesDynamic: jest.fn(),
    getDailyStatsSnapshot: jest.fn(),
    recalculateDrawerBalances: jest.fn(),
    getCheckpointTimeline: jest.fn(),
    createCheckpoint: jest.fn(),
    getLastCheckpointActuals: jest.fn(),
    getLastCheckpointPerDrawer: jest.fn(),
    hasOpeningBalanceToday: jest.fn(),
    hasInitialBalancesSet: jest.fn(),
    hasStartingCheckpoint: jest.fn(),
    getInitialCheckpointDate: jest.fn(),
    updateDailyClosing: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (getSettingsService as jest.Mock).mockReturnValue({
      getAllSettings: jest.fn(),
      getSettingValue: jest.fn(),
      updateSetting: jest.fn(),
    });
    (getExpenseService as jest.Mock).mockReturnValue({
      addExpense: jest.fn(),
      getTodayExpenses: jest.fn(),
      deleteExpense: jest.fn(),
      updateExpenseMetadata: jest.fn(),
    });
    (getClosingService as jest.Mock).mockReturnValue(mockClosingService);
    (getActivityService as jest.Mock).mockReturnValue({
      getSyncErrors: jest.fn(),
      getRecentLogs: jest.fn(),
    });
    (getUserRepository as jest.Mock).mockReturnValue({ findById: jest.fn() });

    registerDatabaseHandlers();
  });

  it("should register closing:get-system-expected-balances-dynamic handler", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "closing:get-system-expected-balances-dynamic",
      expect.any(Function),
    );
  });

  it("should register closing:get-daily-stats-snapshot handler", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "closing:get-daily-stats-snapshot",
      expect.any(Function),
    );
  });

  describe("closing:get-system-expected-balances-dynamic", () => {
    it("delegates to ClosingService and returns the per-drawer/currency balances verbatim", async () => {
      mockClosingService.getSystemExpectedBalancesDynamic.mockReturnValue({
        General: { USD: 1100, LBP: 1600000 },
        OMT_System: { USD: 0, LBP: 0 },
        MTC: { USD: 0 },
      });

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-system-expected-balances-dynamic",
      )[1];
      const result = await handler({});

      expect(
        mockClosingService.getSystemExpectedBalancesDynamic,
      ).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        General: { USD: 1100, LBP: 1600000 },
        OMT_System: { USD: 0, LBP: 0 },
        MTC: { USD: 0 },
      });
    });

    it("returns whatever the service returns verbatim, including its own {} error-normalized fallback — the handler adds no defaulting of its own", async () => {
      // ClosingService.getSystemExpectedBalancesDynamic already catches repo
      // errors and normalizes to {} internally; the handler has no try/catch
      // of its own (unlike the pre-2026 hand-rolled-SQL version this test
      // used to exercise), so there is nothing left for a handler-level
      // "on error, default balances" test to prove — that belongs to
      // ClosingService's own suite.
      mockClosingService.getSystemExpectedBalancesDynamic.mockReturnValue({});

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-system-expected-balances-dynamic",
      )[1];
      const result = await handler({});

      expect(result).toEqual({});
    });
  });

  describe("closing:get-daily-stats-snapshot", () => {
    it("delegates to ClosingService and returns the snapshot verbatim", async () => {
      const snapshot = {
        salesCount: 5,
        totalSalesUSD: 500,
        totalSalesLBP: 750000,
        debtPaymentsUSD: 50,
        debtPaymentsLBP: 100000,
        totalExpensesUSD: 20,
        totalExpensesLBP: 30000,
        totalProfitUSD: 150,
      };
      mockClosingService.getDailyStatsSnapshot.mockReturnValue(snapshot);

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-daily-stats-snapshot",
      )[1];
      const result = await handler({});

      expect(mockClosingService.getDailyStatsSnapshot).toHaveBeenCalledTimes(1);
      expect(result).toEqual(snapshot);
    });

    it("returns an all-zero snapshot verbatim when that is what the service returns (null-coalescing now lives in ClosingRepository, not the handler)", async () => {
      const zeroSnapshot = {
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        totalProfitUSD: 0,
      };
      mockClosingService.getDailyStatsSnapshot.mockReturnValue(zeroSnapshot);

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-daily-stats-snapshot",
      )[1];
      const result = await handler({});

      expect(result).toEqual(zeroSnapshot);
    });
  });
});

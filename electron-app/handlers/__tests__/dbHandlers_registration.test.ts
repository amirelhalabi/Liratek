// electron/handlers/__tests__/dbHandlers_registration.test.ts

/**
 * Revived 2026-09-13 (rotted test suite — see jest.config.cjs header: this
 * whole folder runs under NO configured jest `roots` and drifted unnoticed).
 *
 * What had drifted: `dbHandlers.ts` no longer imports `getDatabase` from
 * `../../db` at all — every handler here resolves its data access through
 * `@liratek/core` service getters (`getSettingsService`, `getExpenseService`,
 * `getClosingService`, `getActivityService`). Mocking `../../db` (as this
 * file used to) mocked nothing the handler touches, so
 * `registerDatabaseHandlers()` reached the REAL, uninitialized core and blew
 * up with "Database not initialized. Call initDatabase() first." Repointed
 * at `@liratek/core` (jest.requireActual + override), matching
 * `debtHandlers.test.ts` / `exchangeLotHandlers.test.ts`.
 *
 * The hardcoded channel list was ALSO stale in two ways:
 *   - `closing:get-system-expected-balances` no longer exists — renamed to
 *     `closing:get-system-expected-balances-dynamic` when the handler moved
 *     from hand-rolled SQL to `ClosingService.getSystemExpectedBalancesDynamic()`
 *     (a `Record<drawerName, Record<currencyCode, balance>>`, not the old
 *     fixed generalDrawer/omtDrawer/... shape).
 *   - `closing:create-daily-closing` is GONE from the IPC surface entirely.
 *     `backend/src/api/closing.ts`'s `POST /daily-closing` route comment
 *     states outright: "createDailyClosing is never called from any
 *     electron-app handler" — it is REST-only now, backed by
 *     `ClosingService.createDailyClosing` (a legacy shim over
 *     `createCheckpoint`). There is nothing in `dbHandlers.ts` for a
 *     `closing:create-daily-closing` registration assertion to find.
 * Both stale entries are replaced below. The list was also incomplete
 * (`registerDatabaseHandlers()` actually registers 27 channels; only 13 were
 * ever asserted, 2 of which no longer exist) — expanded to the full, current
 * list so this test earns the name "registers core channels" instead of
 * spot-checking a third of them.
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

import {
  getSettingsService,
  getExpenseService,
  getClosingService,
  getActivityService,
  getUserRepository,
} from "@liratek/core";

describe("dbHandlers registration", () => {
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
    (getClosingService as jest.Mock).mockReturnValue({
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
    });
    (getActivityService as jest.Mock).mockReturnValue({
      getSyncErrors: jest.fn(),
      getRecentLogs: jest.fn(),
    });
    (getUserRepository as jest.Mock).mockReturnValue({ findById: jest.fn() });
  });

  it("registers core channels", () => {
    const { ipcMain } = require("electron");
    const mod = require("../dbHandlers");
    mod.registerDatabaseHandlers();
    const calls = ipcMain.handle.mock.calls.map((c: any) => c[0]);

    // Full, current channel list registered by registerDatabaseHandlers()
    // (verified against electron-app/handlers/dbHandlers.ts, 2026-09-13).
    [
      "db:get-settings",
      "settings:get-all",
      "db:get-setting",
      "db:update-setting",
      "settings:update",
      "db:add-expense",
      "db:get-today-expenses",
      "db:delete-expense",
      "expenses:update-metadata",
      "closing:get-system-expected-balances-dynamic",
      "closing:get-daily-stats-snapshot",
      "diagnostics:get-sync-errors",
      "diagnostics:getDbPath",
      "closing:recalculate-drawer-balances",
      "closing:getCheckpointTimeline",
      "closing:create-checkpoint",
      "closing:get-last-checkpoint-actuals",
      "closing:get-last-checkpoint-per-drawer",
      "closing:has-opening-balance-today",
      "closing:has-initial-balances-set",
      "closing:has-starting-checkpoint",
      "closing:get-initial-checkpoint-date",
      "closing:update-daily-closing",
      "diagnostics:foreign-key-check",
      "activity:get-recent",
      "database:isJoinInstallation",
      "database:browse",
      "database:changePath",
    ].forEach((ch) => expect(calls).toContain(ch));
  });
});

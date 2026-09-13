// Behavior tests for dbHandlers add-expense, get-today-expenses, delete-expense

/**
 * Revived 2026-09-13 (rotted test suite).
 *
 * What had drifted: this suite mocked `../../db`'s `getDatabase()` with a
 * hand-rolled `prepare()`/`transaction()` SQL fixture simulating an
 * `expenses` table directly. `db:add-expense` / `db:get-today-expenses` /
 * `db:delete-expense` are thin `ExpenseService` delegates
 * (`getExpenseService()` from `@liratek/core`) — the handler never calls
 * `getDatabase()` itself, so the `../../db` mock never intercepted anything
 * and the handler hit the real, uninitialized core ("Database not
 * initialized. Call initDatabase() first."). Repointed at `@liratek/core`'s
 * `getExpenseService` getter (jest.requireActual + override), matching
 * `debtHandlers.test.ts`. `db:add-expense`/`db:delete-expense` are also
 * admin-gated (`requireRole`), so `../../session.js` is mocked too (the old
 * test never exercised the gate at all since it wrote straight to a raw db
 * mock with no auth layer in front of it).
 *
 * Note: this file intentionally does NOT call `jest.resetModules()` between
 * tests (the version it replaces did) — combined with the static
 * `@liratek/core` import below, a mid-test module-registry reset would hand
 * `require("../dbHandlers")` a freshly-evaluated, unconfigured mock instance
 * of `@liratek/core` distinct from the one this file's `beforeEach` just
 * configured via `.mockReturnValue(...)`, silently un-mocking the service
 * getters again. `jest.clearAllMocks()` (calls only, not implementations) is
 * the correct reset here — the same choice `exchangeLotHandlers.test.ts` /
 * `dbHandlers.test.ts` make.
 */

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
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

const ipcMain = originalIpcMain as unknown as { handle: jest.Mock };

describe("dbHandlers expenses behavior", () => {
  // In-memory fixture standing in for the `expenses` table, driven through
  // the mocked ExpenseService rather than raw SQL — preserves the original
  // test's "add, then it shows up in the list, then delete removes it"
  // intent without pretending the handler still talks to the database
  // itself.
  let rowstore: Array<Record<string, unknown>>;
  const mockExpenseService = {
    addExpense: jest.fn(),
    getTodayExpenses: jest.fn(),
    deleteExpense: jest.fn(),
    updateExpenseMetadata: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rowstore = [];

    mockExpenseService.addExpense.mockImplementation(
      (data: Record<string, unknown>) => {
        const id =
          (rowstore.length ? Number(rowstore[rowstore.length - 1].id) : 0) + 1;
        rowstore.push({ id, ...data });
        return { success: true, id };
      },
    );
    mockExpenseService.getTodayExpenses.mockImplementation(() =>
      rowstore.slice(),
    );
    mockExpenseService.deleteExpense.mockImplementation((id: number) => {
      const idx = rowstore.findIndex((r) => r.id === id);
      if (idx >= 0) rowstore.splice(idx, 1);
      return { success: true };
    });

    (getSettingsService as jest.Mock).mockReturnValue({
      getAllSettings: jest.fn(),
      getSettingValue: jest.fn(),
      updateSetting: jest.fn(),
    });
    (getExpenseService as jest.Mock).mockReturnValue(mockExpenseService);
    (getClosingService as jest.Mock).mockReturnValue({
      getSystemExpectedBalancesDynamic: jest.fn(),
      getDailyStatsSnapshot: jest.fn(),
    });
    (getActivityService as jest.Mock).mockReturnValue({
      getSyncErrors: jest.fn(),
      getRecentLogs: jest.fn(),
    });
    (getUserRepository as jest.Mock).mockReturnValue({ findById: jest.fn() });

    registerDatabaseHandlers();
  });

  it("adds and lists expenses", async () => {
    const add = ipcMain.handle.mock.calls.find(
      (c: any) => c[0] === "db:add-expense",
    )[1];
    const list = ipcMain.handle.mock.calls.find(
      (c: any) => c[0] === "db:get-today-expenses",
    )[1];
    const del = ipcMain.handle.mock.calls.find(
      (c: any) => c[0] === "db:delete-expense",
    )[1];

    const res = await add(
      { sender: { id: 1 } },
      {
        description: "Paper",
        category: "Office",
        amount_usd: 10,
        amount_lbp: 0,
        expense_date: "2024-01-01",
      },
    );
    expect(res.success).toBe(true);
    expect(mockExpenseService.addExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Paper",
        category: "Office",
        amount_usd: 10,
        amount_lbp: 0,
        expense_date: "2024-01-01",
      }),
      7, // auth.userId from the mocked requireRole, never trusted from the payload
    );

    const rows = await list({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);

    await del({ sender: { id: 1 } }, (rows[0] as { id: number }).id);
    expect(mockExpenseService.deleteExpense).toHaveBeenCalledWith(
      (rows[0] as { id: number }).id,
      7,
    );

    const rows2 = await list({});
    expect(Array.isArray(rows2)).toBe(true);
    expect(rows2).toHaveLength(0);
  });
});

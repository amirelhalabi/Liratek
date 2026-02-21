// electron/handlers/__tests__/dbHandlers_registration.test.ts

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));
jest.mock("../../db", () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(() => ({
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn(),
    })),
  })),
}));

describe("dbHandlers registration", () => {
  it("registers core channels", () => {
    const { ipcMain } = require("electron");
    const mod = require("../dbHandlers");
    mod.registerDatabaseHandlers();
    const calls = ipcMain.handle.mock.calls.map((c: any) => c[0]);
    [
      "db:get-settings",
      "db:get-setting",
      "db:update-setting",
      "settings:get-all",
      "settings:update",
      "db:add-expense",
      "db:get-today-expenses",
      "db:delete-expense",
      "closing:get-system-expected-balances",
      "closing:create-daily-closing",
      "closing:update-daily-closing",
      "closing:get-daily-stats-snapshot",
      "diagnostics:get-sync-errors",
    ].forEach((ch) => expect(calls).toContain(ch));
  });
});

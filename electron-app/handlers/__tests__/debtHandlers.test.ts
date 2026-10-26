// electron/handlers/__tests__/debtHandlers.test.ts

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

describe("debtHandlers registration", () => {
  it("registers expected IPC channels", () => {
    const { ipcMain: originalIpcMain } = require("electron");
    const ipcMain = originalIpcMain as { handle: jest.Mock };
    const mod = require("../debtHandlers");
    mod.registerDebtHandlers();
    const calls = ipcMain.handle.mock.calls.map((c: any) => c[0]);
    const expected = [
      "debt:get-debtors",
      "debt:get-client-history",
      "debt:get-client-total",
      "debt:add-repayment",
      // LIRA-347 — the settle calendar's month read.
      "debt:get-month-rows",
      "dashboard:get-debt-summary",
    ];
    expected.forEach((ch) => expect(calls).toContain(ch));
  });
});

// electron/handlers/__tests__/salesHandlers.test.ts

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
    transaction: (fn: any) => fn,
  })),
}));

describe("salesHandlers registration", () => {
  it("registers expected IPC channels", () => {
    const { ipcMain: originalIpcMain } = require("electron");
    const ipcMain = originalIpcMain as { handle: jest.Mock };
    const mod = require("../salesHandlers");
    mod.registerSalesHandlers();
    const calls = ipcMain.handle.mock.calls.map((c: any) => c[0]);
    const expected = [
      "sales:process",
      "sales:get-dashboard-stats",
      "dashboard:get-drawer-balances",
      "dashboard:get-profit-sales-chart",
      "sales:get-drafts",
      "sales:get-todays-sales",
      "sales:get-top-products",
    ];
    expected.forEach((ch) => expect(calls).toContain(ch));
  });
});

// electron/handlers/__tests__/inventoryHandlers.test.ts

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

describe("inventoryHandlers registration", () => {
  it("registers expected IPC channels", () => {
    const { ipcMain: originalIpcMain } = require("electron");
    const ipcMain = originalIpcMain as { handle: jest.Mock };
    const mod = require("../inventoryHandlers");
    mod.registerInventoryHandlers();
    const calls = ipcMain.handle.mock.calls.map((c: any) => c[0]);
    const expected = [
      "inventory:get-products",
      "inventory:get-product",
      "inventory:get-product-by-barcode",
      "inventory:create-product",
      "inventory:update-product",
      "inventory:delete-product",
      "inventory:adjust-stock",
      "inventory:get-low-stock-products",
      "inventory:get-stock-stats",
    ];
    expected.forEach((ch) => expect(calls).toContain(ch));
  });
});

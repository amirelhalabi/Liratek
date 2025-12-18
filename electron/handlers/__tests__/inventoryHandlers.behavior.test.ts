// Tests behavior of inventory:create-product handler

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));
const sharedStmt: any = { run: jest.fn(), all: jest.fn(), get: jest.fn() };
jest.mock("../../db", () => ({
  getDatabase: jest.fn(() => ({ prepare: jest.fn(() => sharedStmt) })),
}));

describe("inventory:create-product behavior", () => {
  beforeEach(() => {
    jest.resetModules();
    sharedStmt.run.mockReset();
  });
  it("returns barcode exists on SQLITE_CONSTRAINT_UNIQUE", async () => {
    const { ipcMain } = require("electron");
    const mod = require("../inventoryHandlers");
    mod.registerInventoryHandlers();
    const call = (ipcMain.handle as jest.Mock).mock.calls.find(
      (c: any) => c[0] === "inventory:create-product",
    );
    const handler = call[1];
    sharedStmt.run.mockImplementation(() => {
      const err: any = new Error("unique");
      err.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw err;
    });
    const res = await handler(
      {},
      {
        barcode: "b",
        name: "n",
        category: "c",
        cost_price: 1,
        retail_price: 2,
        stock_quantity: 0,
        min_stock_level: 0,
      },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Barcode/);
  });
  it("returns success true on insert", async () => {
    const { ipcMain } = require("electron");
    const mod = require("../inventoryHandlers");
    mod.registerInventoryHandlers();
    const call = (ipcMain.handle as jest.Mock).mock.calls.find(
      (c: any) => c[0] === "inventory:create-product",
    );
    const handler = call[1];
    sharedStmt.run.mockReturnValue({ lastInsertRowid: 123 });
    const res = await handler(
      {},
      {
        barcode: "b",
        name: "n",
        category: "c",
        cost_price: 1,
        retail_price: 2,
        stock_quantity: 1,
        min_stock_level: 1,
      },
    );
    expect(res.success).toBe(true);
    expect(res.id).toBe(123);
  });
});

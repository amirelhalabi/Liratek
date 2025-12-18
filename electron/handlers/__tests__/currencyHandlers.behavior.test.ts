// Tests behavior of currencies:create handler

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));
const stmt: any = { run: jest.fn(), all: jest.fn(), get: jest.fn() };
jest.mock("../../db", () => ({
  getDatabase: jest.fn(() => ({ prepare: jest.fn(() => stmt) })),
}));
jest.mock("../../session", () => ({
  requireRole: jest.fn(() => ({ ok: true })),
}));

describe("currencies:create behavior", () => {
  beforeEach(() => {
    jest.resetModules();
    stmt.run.mockReset();
  });
  it("returns error on unique violation", async () => {
    const { ipcMain } = require("electron");
    const mod = require("../currencyHandlers");
    mod.registerCurrencyHandlers();
    const call = (ipcMain.handle as jest.Mock).mock.calls.find(
      (c: any) => c[0] === "currencies:create",
    );
    const handler = call[1];
    stmt.run.mockImplementation(() => {
      const err: any = new Error("unique");
      err.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw err;
    });
    const mockEvent = { sender: { id: 1 } };
    const res = await handler(mockEvent, { code: "usd", name: "US Dollar" });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/already exists/i);
  });
});

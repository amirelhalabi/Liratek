// Behavior tests for dbHandlers add-expense, get-today-expenses, delete-expense

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() },
}));
const rowstore: any[] = [];
const stmtObj: any = {
  run: jest.fn((..._args: any[]) => ({ lastInsertRowid: 1 })),
  all: jest.fn(() => []),
  get: jest.fn(() => ({})),
};
jest.mock("../../db", () => ({
  getDatabase: jest.fn(() => ({
    transaction: (fn: any) => () => fn(),
    prepare: jest.fn((sql: string) => {
      if (sql.includes("SELECT * FROM expenses"))
        return { all: jest.fn(() => rowstore.slice()) };
      if (sql.includes("DELETE FROM expenses"))
        return {
          run: jest.fn((id: number) => {
            const idx = rowstore.findIndex((r) => r.id === id);
            if (idx >= 0) rowstore.splice(idx, 1);
            return { changes: 1 };
          }),
        } as any;
      if (sql.includes("INSERT INTO expenses"))
        return {
          run: jest.fn((...a: any[]) => {
            rowstore.push({
              id: (rowstore.at(-1)?.id || 0) + 1,
              description: a[0],
              category: a[1],
              expense_type: a[2],
              paid_by_method: a[3],
              amount_usd: a[4],
              amount_lbp: a[5],
              expense_date: a[6],
            });
            return { lastInsertRowid: rowstore.at(-1).id };
          }),
        } as any;
      if (
        sql.includes("INSERT INTO payments") ||
        sql.includes("INSERT INTO drawer_balances")
      )
        return { run: jest.fn(() => ({})) } as any;
      return stmtObj;
    }),
  })),
}));

describe("dbHandlers expenses behavior", () => {
  beforeEach(() => {
    rowstore.length = 0;
    jest.resetModules();
  });
  it("adds and lists expenses", async () => {
    const { ipcMain } = require("electron");
    const mod = require("../dbHandlers");
    mod.registerDatabaseHandlers();
    const add = (ipcMain.handle as jest.Mock).mock.calls.find(
      (c: any) => c[0] === "db:add-expense",
    )[1];
    const list = (ipcMain.handle as jest.Mock).mock.calls.find(
      (c: any) => c[0] === "db:get-today-expenses",
    )[1];
    const del = (ipcMain.handle as jest.Mock).mock.calls.find(
      (c: any) => c[0] === "db:delete-expense",
    )[1];
    const res = await add(
      {},
      {
        description: "Paper",
        category: "Office",
        expense_type: "OneTime",
        amount_usd: 10,
        amount_lbp: 0,
        expense_date: "2024-01-01",
      },
    );
    expect(res.success).toBe(true);
    const rows = await list({});
    expect(Array.isArray(rows)).toBe(true);
    await del({}, 1);
    const rows2 = await list({});
    expect(Array.isArray(rows2)).toBe(true);
  });
});

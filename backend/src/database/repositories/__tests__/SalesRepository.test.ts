import { jest } from "@jest/globals";
import { SalesRepository } from "../SalesRepository";
import { resetAllMocks } from "../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

let testDb: any;

describe("SalesRepository", () => {
  beforeEach(() => {
    resetAllMocks();
    testDb = (globalThis as any).__LIRATEK_TEST_DB__;
  });

  it("deleteSaleItems deletes by sale_id", () => {
    const repo = new SalesRepository();

    (testDb.prepare as any).mockImplementationOnce((sql: any) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.run = jest.fn(() => ({ changes: 2 }));
      return stmt;
    });

    repo.deleteSaleItems(10);

    expect(testDb.prepare).toHaveBeenCalledWith(
      "DELETE FROM sale_items WHERE sale_id = ?",
    );
  });

  it("deleteSaleItems throws DatabaseError on failure", () => {
    const repo = new SalesRepository();

    (testDb.prepare as any).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => repo.deleteSaleItems(10)).toThrow(
      /Failed to delete sale items/,
    );
  });
});

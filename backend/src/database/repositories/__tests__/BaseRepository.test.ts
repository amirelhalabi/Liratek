import { jest } from "@jest/globals";
import { BaseRepository } from "../BaseRepository";
import { resetAllMocks } from "../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

// Core repositories use @liratek/core db/connection, provided via global test hook.
// No need to mock backend connection module here.

type TestEntity = { id: number; name: string; created_at?: string };

class TestRepo extends BaseRepository<TestEntity> {
  constructor() {
    super("test_table");
  }
}

describe("BaseRepository", () => {
  let testDb: any;

  beforeEach(() => {
    resetAllMocks();
    // Ensure @liratek/core is using a mock DB
    testDb = (globalThis as any).__LIRATEK_TEST_DB__;
    expect(testDb).toBeTruthy();
    expect(typeof testDb.prepare).toBe("function");
  });

  it("findById returns entity when found", () => {
    // Arrange
    testDb.prepare.mockImplementationOnce((sql: string) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.get = jest.fn(() => ({ id: 1, name: "A" }));
      return stmt;
    });

    const repo = new TestRepo();
    const res = repo.findById(1);

    expect(res).toEqual({ id: 1, name: "A" });
    expect(testDb.prepare).toHaveBeenCalledWith(
      "SELECT * FROM test_table WHERE id = ?",
    );
  });

  it("findAll builds ORDER BY / LIMIT / OFFSET", () => {
    testDb.prepare.mockImplementationOnce((sql: string) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.all = jest.fn(() => [{ id: 1, name: "A" }]);
      return stmt;
    });

    const repo = new TestRepo();
    const res = repo.findAll({
      orderBy: "id",
      orderDirection: "DESC",
      limit: 10,
      offset: 5,
    });

    expect(res).toEqual([{ id: 1, name: "A" }]);
    expect(testDb.prepare).toHaveBeenCalledWith(
      "SELECT * FROM test_table ORDER BY id DESC LIMIT ? OFFSET ?",
    );
  });

  it("delete executes delete query", () => {
    testDb.prepare.mockImplementationOnce((sql: string) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.run = jest.fn(() => ({ changes: 1 }));
      return stmt;
    });

    const repo = new TestRepo();
    const ok = repo.delete(1);

    expect(ok).toBe(true);
    expect(testDb.prepare).toHaveBeenCalled();
    const sqls = testDb.prepare.mock.calls.map((c: any[]) => c[0]);
    expect(sqls).toContain("DELETE FROM test_table WHERE id = ?");
  });
});

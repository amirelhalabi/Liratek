import { jest } from "@jest/globals";
import { BaseRepository } from "@liratek/core";
import { resetAllMocks } from "../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

// Core repositories use @liratek/core db/connection, provided via global test hook.
// No need to mock backend connection module here.

type TestEntity = { id: number; name: string; created_at?: string };

class TestRepo extends BaseRepository<TestEntity> {
  constructor() {
    super("test_table");
  }

  // Override getColumns() - required since BaseRepository now enforces this
  protected getColumns(): string {
    return "id, name, created_at";
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
    testDb.prepare.mockImplementation((sql: string) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      
      // Handle PRAGMA table_info call from hasColumn
      if (sql.includes("PRAGMA")) {
        stmt.all = jest.fn(() => []);
        return stmt;
      }

      stmt.get = jest.fn(() => ({ id: 1, name: "A" }));
      return stmt;
    });

    const repo = new TestRepo();
    const res = repo.findById(1);

    expect(res).toEqual({ id: 1, name: "A" });
    // Expect the SELECT query. The test ignores PRAGMA calls order if we check specifically for SELECT
    expect(testDb.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT id, name, created_at FROM test_table.*WHERE id = \?/),
    );
  });

  it("findAll builds ORDER BY / LIMIT / OFFSET", () => {
    testDb.prepare.mockImplementation((sql: string) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };

      // Handle PRAGMA table_info call from hasColumn
      if (sql.includes("PRAGMA")) {
        stmt.all = jest.fn(() => []);
        return stmt;
      }

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
      expect.stringMatching(/SELECT id, name, created_at FROM test_table.*ORDER BY id DESC LIMIT \? OFFSET \?/),
    );
  });

  it("delete executes delete query", () => {
    testDb.prepare.mockImplementation((sql: string) => {
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
    // Use regex to match DELETE query
    expect(sqls).toEqual(expect.arrayContaining([expect.stringMatching(/DELETE FROM test_table WHERE id = \?/)]));
  });
});

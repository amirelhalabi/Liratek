import { BaseRepository } from "../BaseRepository";
import {
  mockDatabase,
  resetAllMocks,
} from "../../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

jest.mock("../../../db", () => ({
  getDatabase: () => mockDatabase,
}));

type TestEntity = { id: number; name: string; created_at?: string };

class TestRepo extends BaseRepository<TestEntity> {
  constructor() {
    super("test_table");
  }
}

describe("BaseRepository", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("findById returns entity when found", () => {
    // Arrange
    mockDatabase.prepare.mockImplementationOnce((sql: string) => {
      const stmt = {
        ...require("../../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.get = jest.fn(() => ({ id: 1, name: "A" }));
      return stmt;
    });

    const repo = new TestRepo();
    const res = repo.findById(1);

    expect(res).toEqual({ id: 1, name: "A" });
    expect(mockDatabase.prepare).toHaveBeenCalledWith(
      "SELECT * FROM test_table WHERE id = ?",
    );
  });

  it("findAll builds ORDER BY / LIMIT / OFFSET", () => {
    mockDatabase.prepare.mockImplementationOnce((sql: string) => {
      const stmt = {
        ...require("../../../../__mocks__/better-sqlite3").mockStatement,
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
    expect(mockDatabase.prepare).toHaveBeenCalledWith(
      "SELECT * FROM test_table ORDER BY id DESC LIMIT ? OFFSET ?",
    );
  });

  it("delete executes delete query", () => {
    mockDatabase.prepare.mockImplementationOnce((sql: string) => {
      const stmt = {
        ...require("../../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.run = jest.fn(() => ({ changes: 1 }));
      return stmt;
    });

    const repo = new TestRepo();
    const ok = repo.delete(1);

    expect(ok).toBe(true);
    expect(mockDatabase.prepare).toHaveBeenCalledWith(
      "DELETE FROM test_table WHERE id = ?",
    );
  });
});

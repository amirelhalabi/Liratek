import { jest } from "@jest/globals";
import { ClientRepository } from "@liratek/core";
import { resetAllMocks } from "../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

let testDb: any;

describe("ClientRepository", () => {
  beforeEach(() => {
    resetAllMocks();
    testDb = (globalThis as any).__LIRATEK_TEST_DB__;
  });

  it("findAllClients applies search filter", () => {
    const repo = new ClientRepository();

    // mock query execution
    (testDb.prepare as any).mockImplementationOnce((sql: any) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.all = jest.fn(() => [
        { id: 1, name: "Ali", phone: "1", created_at: "" },
      ]);
      return stmt;
    });

    const res = repo.findAllClients("Ali");
    expect(res.length).toBe(1);
    expect(testDb.prepare).toHaveBeenCalled();
  });

  it("createClient maps SQLITE_CONSTRAINT_UNIQUE to DUPLICATE_PHONE", () => {
    const repo = new ClientRepository();

    (testDb.prepare as any).mockImplementationOnce(() => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
      };
      stmt.run = jest.fn(() => {
        const err: any = new Error("constraint");
        err.code = "SQLITE_CONSTRAINT_UNIQUE";
        throw err;
      });
      return stmt;
    });

    expect(() =>
      repo.createClient({ full_name: "A", phone_number: "1" }, 1),
    ).toThrow(/Phone number already registered/);
  });

  it("deleteClient blocks delete if sales history exists", () => {
    const repo = new ClientRepository();

    // hasSalesHistory query
    (testDb.prepare as any).mockImplementationOnce((sql: any) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.get = jest.fn(() => ({ count: 2 }));
      return stmt;
    });

    expect(() => repo.deleteClient(1, 1)).toThrow(/Cannot delete client/);
  });

  it("deleteClient deletes when no history", () => {
    const repo = new ClientRepository();

    // hasSalesHistory query
    (testDb.prepare as any).mockImplementationOnce((sql: any) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.get = jest.fn(() => ({ count: 0 }));
      return stmt;
    });

    // delete query from BaseRepository
    (testDb.prepare as any).mockImplementationOnce((sql: any) => {
      const stmt = {
        ...require("../../../__mocks__/better-sqlite3").mockStatement,
        _sql: sql,
      };
      stmt.run = jest.fn(() => ({ changes: 1 }));
      return stmt;
    });

    const ok = repo.deleteClient(1, 1);
    expect(ok).toBe(true);
  });
});

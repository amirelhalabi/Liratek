import { SalesRepository } from "../SalesRepository";
import {
  mockDatabase,
  resetAllMocks,
} from "../../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");

jest.mock("../../../db", () => ({
  getDatabase: () => mockDatabase,
}));

describe("SalesRepository", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("deleteSaleItems deletes by sale_id", () => {
    const repo = new SalesRepository();

    (mockDatabase.prepare as jest.Mock).mockImplementationOnce(
      (sql: string) => {
        const stmt = {
          ...require("../../../../__mocks__/better-sqlite3").mockStatement,
          _sql: sql,
        };
        stmt.run = jest.fn(() => ({ changes: 2 }));
        return stmt;
      },
    );

    repo.deleteSaleItems(10);

    expect(mockDatabase.prepare).toHaveBeenCalledWith(
      "DELETE FROM sale_items WHERE sale_id = ?",
    );
  });

  it("deleteSaleItems throws DatabaseError on failure", () => {
    const repo = new SalesRepository();

    (mockDatabase.prepare as jest.Mock).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => repo.deleteSaleItems(10)).toThrow(
      /Failed to delete sale items/,
    );
  });
});

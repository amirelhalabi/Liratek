// Mock for better-sqlite3 used by backend unit tests (ESM)
import { jest } from "@jest/globals";

// Mock for a single Statement object
export const mockStatement = {
  run: jest.fn(function (this: any, ..._args: any[]) {
    if (this._sql.trim().toUpperCase().startsWith("INSERT")) {
      return { changes: 1, lastInsertRowid: 1 };
    }
    return { changes: 1 };
  }),
  all: jest.fn(function (this: any, ..._args: any[]) {
    return [];
  }),
  get: jest.fn(function (this: any, ..._args: any[]) {
    return undefined;
  }),
};

// Mock for the Database object
export const mockDatabase = {
  prepare: jest.fn((sql: string) => ({
    ...mockStatement,
    _sql: sql,
  })),
  exec: jest.fn(),
  pragma: jest.fn(),
  close: jest.fn(),
};

const Database = jest.fn(() => mockDatabase);

export default Database;

export const resetAllMocks = () => {
  Database.mockClear();
  mockDatabase.prepare.mockClear();
  mockDatabase.exec.mockClear();
  mockDatabase.close.mockClear();
  mockStatement.run.mockClear();
  mockStatement.all.mockClear();
  mockStatement.get.mockClear();
};

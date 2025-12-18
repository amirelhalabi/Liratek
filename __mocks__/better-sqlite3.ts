// __mocks__/better-sqlite3.ts

// Mock for a single Statement object
export const mockStatement = {
  // Export mockStatement too for more granular control
  run: jest.fn(function (this: any, ..._args: any[]) {
    // Changed args to _args
    if (this._sql.trim().toUpperCase().startsWith("INSERT")) {
      return { changes: 1, lastInsertRowid: 1 };
    }
    return { changes: 1 };
  }),
  all: jest.fn(function (this: any, ..._args: any[]) {
    // Changed args to _args
    if (this._sql.includes("FROM expenses")) {
      return [];
    }
    if (
      this._sql.includes("FROM sales") ||
      this._sql.includes("FROM debt_ledger")
    ) {
      return [
        {
          total_usd_sales: 0,
          total_lbp_sales: 0,
          total_usd_repayments: 0,
          total_lbp_repayments: 0,
          total_expenses_usd: 0,
          total_lbp_expenses: 0,
          total_profit_usd: 0,
        },
      ];
    }
    return [];
  }),
  get: jest.fn(function (this: any, ..._args: any[]) {
    // Changed args to _args
    if (this._sql.includes("FROM system_settings WHERE key_name = ?")) {
      return { value: "mock_setting_value" };
    }
    if (this._sql.includes("FROM expenses WHERE id = ?")) {
      return { id: _args[0], category: "Mock", amount_usd: 100 };
    }
    if (
      this._sql.includes("FROM sales") ||
      this._sql.includes("FROM debt_ledger")
    ) {
      return {
        total_usd_sales: 0,
        total_lbp_sales: 0,
        total_usd_repayments: 0,
        total_lbp_repayments: 0,
        total_expenses_usd: 0,
        total_lbp_expenses: 0,
        total_profit_usd: 0,
      };
    }
    return undefined;
  }),
};

// Mock for the Database object
export const mockDatabase = {
  // Export mockDatabase
  prepare: jest.fn((sql: string) => ({
    ...mockStatement,
    _sql: sql,
  })),
  exec: jest.fn(),
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

"use strict";
// __mocks__/better-sqlite3.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAllMocks = exports.mockDatabase = exports.mockStatement = void 0;
// Mock for a single Statement object
exports.mockStatement = {
    // Export mockStatement too for more granular control
    run: jest.fn(function (..._args) {
        // Changed args to _args
        if (this._sql.trim().toUpperCase().startsWith("INSERT")) {
            return { changes: 1, lastInsertRowid: 1 };
        }
        return { changes: 1 };
    }),
    all: jest.fn(function (..._args) {
        // Changed args to _args
        if (this._sql.includes("FROM expenses")) {
            return [];
        }
        if (this._sql.includes("FROM sales") ||
            this._sql.includes("FROM debt_ledger")) {
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
    get: jest.fn(function (..._args) {
        // Changed args to _args
        if (this._sql.includes("FROM system_settings WHERE key_name = ?")) {
            return { value: "mock_setting_value" };
        }
        if (this._sql.includes("FROM expenses WHERE id = ?")) {
            return { id: _args[0], category: "Mock", amount_usd: 100 };
        }
        if (this._sql.includes("FROM sales") ||
            this._sql.includes("FROM debt_ledger")) {
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
exports.mockDatabase = {
    // Export mockDatabase
    prepare: jest.fn((sql) => ({
        ...exports.mockStatement,
        _sql: sql,
    })),
    exec: jest.fn(),
    pragma: jest.fn(),
    close: jest.fn(),
};
const Database = jest.fn(() => exports.mockDatabase);
exports.default = Database;
const resetAllMocks = () => {
    Database.mockClear();
    exports.mockDatabase.prepare.mockClear();
    exports.mockDatabase.exec.mockClear();
    exports.mockDatabase.close.mockClear();
    exports.mockStatement.run.mockClear();
    exports.mockStatement.all.mockClear();
    exports.mockStatement.get.mockClear();
};
exports.resetAllMocks = resetAllMocks;

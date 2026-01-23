// electron/handlers/__tests__/dbHandlers.test.ts

// Mock Electron explicitly first
jest.mock("electron", () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn(),
  },
  app: {
    // Also mock app, just in case dbHandlers uses it directly or indirectly
    getPath: jest.fn(() => "/tmp"),
    isPackaged: false,
  },
}));

// Mock the db module explicitly with a shared singleton instance
const sharedMockDbInstance = {
  prepare: jest.fn(),
  exec: jest.fn(),
  close: jest.fn(),
};
jest.mock("../../db", () => ({
  getDatabase: jest.fn(() => sharedMockDbInstance),
  closeDatabase: jest.fn(),
}));

// Now import the actual modules. Order matters.
// Do NOT import registerDatabaseHandlers at the top
// import { registerDatabaseHandlers } from '../dbHandlers'; // REMOVE THIS LINE
import { ipcMain as originalIpcMain } from "electron"; // Import the original (mocked) ipcMain

// Explicitly cast to Jest mock type for use in tests
const ipcMain = originalIpcMain as unknown as {
  handle: jest.Mock;
  on: jest.Mock;
  removeHandler: jest.Mock;
};

describe("dbHandlers IPC: Closing functionality", () => {
  let mockDbInstance: any; // The mocked database instance
  let registerDatabaseHandlers: any; // Declare it here

  beforeEach(() => {
    // Changed from beforeAll to beforeEach
    // Dynamically import dbHandlers to ensure mocks are active
    const handlersModule = require("../dbHandlers");
    registerDatabaseHandlers = handlersModule.registerDatabaseHandlers;

    mockDbInstance = (jest.requireMock("../../db") as any).getDatabase();
    // Ensure our shared instance is used
    expect(mockDbInstance).toBe(sharedMockDbInstance);

    // Clear specific mocks to avoid interference between tests
    ipcMain.handle.mockClear();
    ipcMain.on.mockClear();
    ipcMain.removeHandler.mockClear();
    mockDbInstance.prepare.mockClear();

    // Provide a mock transaction implementation used by handlers
    (mockDbInstance as any).transaction = jest.fn((fn: any) => {
      return (...args: any[]) => fn(...args);
    });

    // Setup a robust default mockImplementation for prepare that returns fresh statement mocks
    (mockDbInstance.prepare as jest.Mock).mockImplementation((sql: string) => {
      // Each call to prepare returns a new statement mock object
      // These can be individually mocked in specific tests
      const statementRun = jest.fn(() => ({ changes: 1, lastInsertRowid: 1 }));
      const statementAll = jest.fn(() => []);
      const statementGet = jest.fn(() => undefined);

      // Specific handling for daily_closings insert if needed by default
      if (sql.trim().toUpperCase().startsWith("INSERT INTO DAILY_CLOSINGS")) {
        statementRun.mockReturnValueOnce({ changes: 1, lastInsertRowid: 101 });
      }

      return {
        run: statementRun,
        all: statementAll,
        get: statementGet,
        _sql: sql, // For debugging or conditional mocking based on SQL
      };
    });

    registerDatabaseHandlers(); // Now register handlers after default prepare mock is set
  });

  it("should register closing:get-system-expected-balances handler", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "closing:get-system-expected-balances",
      expect.any(Function),
    );
  });

  it("should register closing:create-daily-closing handler", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "closing:create-daily-closing",
      expect.any(Function),
    );
  });

  it("should register closing:get-daily-stats-snapshot handler", () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(
      "closing:get-daily-stats-snapshot",
      expect.any(Function),
    );
  });

  describe("closing:get-system-expected-balances", () => {
    it("should return correct expected balances based on sales, repayments, and expenses", async () => {
      // New model: expected balances are read from drawer_balances
      const drawerBalances = new Map<string, number>([
        ["General|USD", 1100],
        ["General|LBP", 1600000],
        ["OMT|USD", 0],
        ["OMT|LBP", 0],
        ["Whish|USD", 0],
        ["Whish|LBP", 0],
        ["Binance|USD", 0],
        ["Binance|LBP", 0],
        ["MTC|USD", 0],
        ["Alfa|USD", 0],
      ]);

      (mockDbInstance.prepare as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes("FROM drawer_balances")) {
          return {
            get: jest.fn((drawer_name: string, currency_code: string) => {
              const key = `${drawer_name}|${currency_code}`;
              const balance = drawerBalances.get(key);
              return balance != null ? { balance } : undefined;
            }),
            run: jest.fn(),
            all: jest.fn(),
            _sql: sql,
          };
        }
        return { get: jest.fn(), run: jest.fn(), all: jest.fn(), _sql: sql };
      });

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-system-expected-balances",
      )[1];
      const result = await handler({}); // Pass empty event object

      expect(result).toEqual({
        generalDrawer: { usd: 1100, lbp: 1600000, eur: 0 },
        omtDrawer: { usd: 0, lbp: 0, eur: 0 },
        whishDrawer: { usd: 0, lbp: 0, eur: 0 },
        binanceDrawer: { usd: 0, lbp: 0, eur: 0 },
        mtcDrawer: { usd: 0, lbp: 0, eur: 0 },
        alfaDrawer: { usd: 0, lbp: 0, eur: 0 },
      });
      expect(mockDbInstance.prepare).toHaveBeenCalledTimes(10); // drawer_balances read per (drawer,currency) combo
    });

    it("should handle zero balances gracefully", async () => {
      const mockZeroResult = {
        total_usd_sales: null,
        total_lbp_sales: null,
        total_usd_repayments: null,
        total_lbp_repayments: null,
        total_usd_expenses: null,
        total_lbp_expenses: null,
      };

      (mockDbInstance.prepare as jest.Mock).mockImplementation((sql) => ({
        get: jest.fn(() => mockZeroResult),
        run: jest.fn(),
        all: jest.fn(),
        _sql: sql,
      }));

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-system-expected-balances",
      )[1];
      const result = await handler({});

      expect(result).toEqual({
        generalDrawer: { usd: 0, lbp: 0, eur: 0 },
        omtDrawer: { usd: 0, lbp: 0, eur: 0 },
        whishDrawer: { usd: 0, lbp: 0, eur: 0 },
        binanceDrawer: { usd: 0, lbp: 0, eur: 0 },
        mtcDrawer: { usd: 0, lbp: 0, eur: 0 },
        alfaDrawer: { usd: 0, lbp: 0, eur: 0 },
      });
    });

    it("should return default zero balances on error", async () => {
      (mockDbInstance.prepare as jest.Mock).mockImplementation(() => {
        return {
          get: jest.fn(() => {
            throw new Error("DB error");
          }),
          run: jest.fn(),
          all: jest.fn(),
        };
      });

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-system-expected-balances",
      )[1];
      const result = await handler({});

      expect(result).toEqual({
        generalDrawer: { usd: 0, lbp: 0, eur: 0 },
        omtDrawer: { usd: 0, lbp: 0, eur: 0 },
        whishDrawer: { usd: 0, lbp: 0, eur: 0 },
        binanceDrawer: { usd: 0, lbp: 0, eur: 0 },
        mtcDrawer: { usd: 0, lbp: 0, eur: 0 },
        alfaDrawer: { usd: 0, lbp: 0, eur: 0 },
      });
    });
  });

  describe("closing:create-daily-closing", () => {
    it("should insert a new daily closing record and log activity", async () => {
      const mockData = {
        closing_date: "2023-01-01",
        system_expected_usd: 105,
        system_expected_lbp: 102000,
        variance_notes: "Test closing variance",
        amounts: [
          {
            drawer_name: "General_Drawer_B",
            currency_code: "USD",
            physical_amount: 110,
            opening_amount: 100,
          },
          {
            drawer_name: "General_Drawer_B",
            currency_code: "LBP",
            physical_amount: 105000,
            opening_amount: 100000,
          },
          {
            drawer_name: "General_Drawer_B",
            currency_code: "EUR",
            physical_amount: 50,
            opening_amount: 0,
          },
        ],
      };

      // Mock the run methods for daily_closings and activity_logs
      (mockDbInstance.prepare as jest.Mock)
        .mockImplementationOnce((sql) => ({
          run: jest.fn(() => ({ changes: 1, lastInsertRowid: 101 })),
          all: jest.fn(),
          get: jest.fn(),
          _sql: sql,
        })) // For daily_closings INSERT
        .mockImplementationOnce((sql) => ({
          run: jest.fn(),
          all: jest.fn(),
          get: jest.fn(),
          _sql: sql,
        })); // For activity_logs INSERT

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:create-daily-closing",
      )[1];
      const result = await handler({}, mockData);

      expect(result).toEqual({ success: true, id: 101 });
      expect(mockDbInstance.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO daily_closings"),
      );
      expect(mockDbInstance.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO activity_logs"),
      );

      // Verify run calls directly on the prepared statements
      expect(
        mockDbInstance.prepare.mock.results[0].value.run,
      ).toHaveBeenCalledWith(
        mockData.closing_date,
        mockData.system_expected_usd,
        mockData.system_expected_lbp,
        mockData.variance_notes ?? null,
        null,
      );

      // Verify per-amount inserts were attempted
      expect(mockDbInstance.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO daily_closing_amounts"),
      );

      // Find the prepared statement used for activity_logs and assert its run args
      const activityLogPrepareIndex =
        mockDbInstance.prepare.mock.calls.findIndex(
          (args: any[]) =>
            typeof args[0] === "string" &&
            args[0].includes("INSERT INTO activity_logs"),
        );
      expect(activityLogPrepareIndex).toBeGreaterThanOrEqual(0);
      const activityRun =
        mockDbInstance.prepare.mock.results[activityLogPrepareIndex].value.run;
      // In handler SQL, user_id/action/table are hardcoded and only record_id and details_json are bound as params
      expect(activityRun).toHaveBeenCalledWith(
        101, // record_id
        JSON.stringify({ amounts: mockData.amounts }), // details_json matches handler
      );
    });

    it("should return success false on database error", async () => {
      (mockDbInstance.prepare as jest.Mock).mockImplementation(() => {
        return {
          run: jest.fn(() => {
            throw new Error("DB insert error");
          }),
          all: jest.fn(),
          get: jest.fn(),
        };
      });

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:create-daily-closing",
      )[1];
      const result = await handler(
        {},
        { closing_date: "2023-01-01", amounts: [] },
      ); // Minimal valid payload to pass Zod

      expect(result).toEqual({ success: false, error: "DB insert error" });
    });
  });

  describe("closing:get-daily-stats-snapshot", () => {
    it("should return correct daily stats snapshot", async () => {
      const mockSalesStats = {
        sales_count: 5,
        total_sales_usd: 500,
        total_sales_lbp: 750000,
      };
      const mockDebtPayments = {
        total_debt_payments_usd: 50,
        total_debt_payments_lbp: 100000,
      };
      const mockExpensesStats = {
        total_expenses_usd: 20,
        total_expenses_lbp: 30000,
      };
      const mockProfitStats = { total_profit_usd: 150 };

      // Set up sequential get results for the prepare calls
      (mockDbInstance.prepare as jest.Mock)
        .mockImplementationOnce((sql) => ({
          get: jest.fn(() => mockSalesStats),
          run: jest.fn(),
          all: jest.fn(),
          _sql: sql,
        })) // sales stats
        .mockImplementationOnce((sql) => ({
          get: jest.fn(() => mockDebtPayments),
          run: jest.fn(),
          all: jest.fn(),
          _sql: sql,
        })) // debt payments
        .mockImplementationOnce((sql) => ({
          get: jest.fn(() => mockExpensesStats),
          run: jest.fn(),
          all: jest.fn(),
          _sql: sql,
        })) // expenses
        .mockImplementationOnce((sql) => ({
          get: jest.fn(() => mockProfitStats),
          run: jest.fn(),
          all: jest.fn(),
          _sql: sql,
        })); // profit

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-daily-stats-snapshot",
      )[1];
      const result = await handler({});

      expect(result).toEqual({
        salesCount: 5,
        totalSalesUSD: 500,
        totalSalesLBP: 750000,
        debtPaymentsUSD: 50,
        debtPaymentsLBP: 100000,
        totalExpensesUSD: 20,
        totalExpensesLBP: 30000,
        totalProfitUSD: 150,
      });
      expect(mockDbInstance.prepare).toHaveBeenCalledTimes(4); // sales (count), debt_ledger, expenses, sales (profit)
    });

    it("should handle null/zero stats gracefully", async () => {
      const mockNullStats = {
        sales_count: null,
        total_sales_usd: null,
        total_sales_lbp: null,
        total_debt_payments_usd: null,
        total_debt_payments_lbp: null,
        total_expenses_usd: null,
        total_expenses_lbp: null,
        total_profit_usd: null,
      };

      (mockDbInstance.prepare as jest.Mock).mockImplementation((sql) => ({
        get: jest.fn(() => mockNullStats),
        run: jest.fn(),
        all: jest.fn(),
        _sql: sql,
      }));

      const handler = ipcMain.handle.mock.calls.find(
        (call) => call[0] === "closing:get-daily-stats-snapshot",
      )[1];
      const result = await handler({});

      expect(result).toEqual({
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        totalProfitUSD: 0,
      });
    });
  });
});

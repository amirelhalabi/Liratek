// electron/handlers/__tests__/dbHandlers.test.ts

// Mock Electron explicitly first
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn(),
  },
  app: { // Also mock app, just in case dbHandlers uses it directly or indirectly
    getPath: jest.fn(() => '/tmp'),
    isPackaged: false,
  },
}));

// Mock the db module explicitly
jest.mock('../../db', () => ({
  getDatabase: jest.fn(() => ({
    prepare: jest.fn(), // prepare itself is a mock function
    exec: jest.fn(),
    close: jest.fn(),
  })),
  closeDatabase: jest.fn(),
}));

// Now import the actual modules. Order matters.
// Do NOT import registerDatabaseHandlers at the top
// import { registerDatabaseHandlers } from '../dbHandlers'; // REMOVE THIS LINE
import { ipcMain as originalIpcMain } from 'electron'; // Import the original (mocked) ipcMain

// Explicitly cast to Jest mock type for use in tests
const ipcMain = originalIpcMain as unknown as {
    handle: jest.Mock;
    on: jest.Mock;
    removeHandler: jest.Mock;
};


describe('dbHandlers IPC: Closing functionality', () => {
  let mockDbInstance: any; // The mocked database instance
  let registerDatabaseHandlers: any; // Declare it here


  beforeEach(() => { // Changed from beforeAll to beforeEach
    // Dynamically import dbHandlers to ensure mocks are active
    const handlersModule = require('../dbHandlers');
    registerDatabaseHandlers = handlersModule.registerDatabaseHandlers;

    mockDbInstance = (jest.requireMock('../../db') as any).getDatabase();

    // Clear specific mocks to avoid interference between tests
    ipcMain.handle.mockClear();
    ipcMain.on.mockClear();
    ipcMain.removeHandler.mockClear();
    mockDbInstance.prepare.mockClear();

    // Setup a robust default mockImplementation for prepare that returns fresh statement mocks
    (mockDbInstance.prepare as jest.Mock).mockImplementation((sql: string) => {
        // Each call to prepare returns a new statement mock object
        // These can be individually mocked in specific tests
        const statementRun = jest.fn(() => ({ changes: 1, lastInsertRowid: 1 }));
        const statementAll = jest.fn(() => []);
        const statementGet = jest.fn(() => undefined);

        // Specific handling for daily_closings insert if needed by default
        if (sql.trim().toUpperCase().startsWith('INSERT INTO DAILY_CLOSINGS')) {
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

  it('should register closing:get-system-expected-balances handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('closing:get-system-expected-balances', expect.any(Function));
  });

  it('should register closing:create-daily-closing handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('closing:create-daily-closing', expect.any(Function));
  });

  it('should register closing:get-daily-stats-snapshot handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('closing:get-daily-stats-snapshot', expect.any(Function));
  });

  describe('closing:get-system-expected-balances', () => {
    it('should return correct expected balances based on sales, repayments, and expenses', async () => {
      // Mock the database calls for calculations
      const mockSalesResult = { total_usd_sales: 1000, total_lbp_sales: 1500000 };
      const mockRepaymentsResult = { total_usd_repayments: 200, total_lbp_repayments: 300000 };
      const mockExpensesResult = { total_usd_expenses: 100, total_lbp_expenses: 200000 };

      // Set up sequential get results for the prepare calls in dbHandlers.ts
      (mockDbInstance.prepare as jest.Mock)
        .mockImplementationOnce((sql) => ({ get: jest.fn(() => mockSalesResult), run: jest.fn(), all: jest.fn(), _sql: sql })) // Sales query
        .mockImplementationOnce((sql) => ({ get: jest.fn(() => mockRepaymentsResult), run: jest.fn(), all: jest.fn(), _sql: sql })) // Debt_ledger query
        .mockImplementationOnce((sql) => ({ get: jest.fn(() => mockExpensesResult), run: jest.fn(), all: jest.fn(), _sql: sql })); // Expenses query
      

      const handler = ipcMain.handle.mock.calls.find(call => call[0] === 'closing:get-system-expected-balances')[1];
      const result = await handler({}); // Pass empty event object

      expect(result).toEqual({
        generalDrawer: {
          usd: 1000 + 200 - 100, // Sales + Repayments - Expenses
          lbp: 1500000 + 300000 - 200000,
          eur: 0,
        },
        omtDrawer: {
          usd: 0,
          lbp: 0,
          eur: 0,
        },
      });
      expect(mockDbInstance.prepare).toHaveBeenCalledTimes(3); // sales, debt_ledger, expenses
    });

    it('should handle zero balances gracefully', async () => {
        const mockZeroResult = { total_usd_sales: null, total_lbp_sales: null, total_usd_repayments: null, total_lbp_repayments: null, total_usd_expenses: null, total_lbp_expenses: null };
        
        (mockDbInstance.prepare as jest.Mock).mockImplementation((sql) => ({ get: jest.fn(() => mockZeroResult), run: jest.fn(), all: jest.fn(), _sql: sql }));

        const handler = ipcMain.handle.mock.calls.find(call => call[0] === 'closing:get-system-expected-balances')[1];
        const result = await handler({});

        expect(result).toEqual({
            generalDrawer: { usd: 0, lbp: 0, eur: 0 },
            omtDrawer: { usd: 0, lbp: 0, eur: 0 },
        });
    });

    it('should return default zero balances on error', async () => {
        (mockDbInstance.prepare as jest.Mock).mockImplementation(() => {
            return {
                get: jest.fn(() => { throw new Error('DB error'); }),
                run: jest.fn(), all: jest.fn(),
            };
        });

        const handler = ipcMain.handle.mock.calls.find(call => call[0] === 'closing:get-system-expected-balances')[1];
        const result = await handler({});

        expect(result).toEqual({
            generalDrawer: { usd: 0, lbp: 0, eur: 0 },
            omtDrawer: { usd: 0, lbp: 0, eur: 0 }
        });
    });
  });

  describe('closing:create-daily-closing', () => {
    it('should insert a new daily closing record and log activity', async () => {
      const mockData = {
        closing_date: '2023-01-01',
        drawer_name: 'General_Drawer_B',
        opening_balance_usd: 100,
        opening_balance_lbp: 100000,
        physical_usd: 110,
        physical_lbp: 105000,
        physical_eur: 50,
        system_expected_usd: 105,
        system_expected_lbp: 102000,
        variance_usd: 5,
        notes: 'Test closing',
      };

      // Mock the run methods for daily_closings and activity_logs
      (mockDbInstance.prepare as jest.Mock)
        .mockImplementationOnce((sql) => ({ run: jest.fn(() => ({ changes: 1, lastInsertRowid: 101 })), all: jest.fn(), get: jest.fn(), _sql: sql })) // For daily_closings INSERT
        .mockImplementationOnce((sql) => ({ run: jest.fn(), all: jest.fn(), get: jest.fn(), _sql: sql })); // For activity_logs INSERT


      const handler = ipcMain.handle.mock.calls.find(call => call[0] === 'closing:create-daily-closing')[1];
      const result = await handler({}, mockData);

      expect(result).toEqual({ success: true, id: 101 });
      expect(mockDbInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO daily_closings'));
      expect(mockDbInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO activity_logs'));

      // Verify run calls directly on the prepared statements
      expect(mockDbInstance.prepare.mock.results[0].value.run).toHaveBeenCalledWith(
        mockData.closing_date,
        mockData.drawer_name,
        mockData.opening_balance_usd,
        mockData.opening_balance_lbp,
        mockData.physical_usd,
        mockData.physical_lbp,
        mockData.physical_eur,
        mockData.system_expected_usd,
        mockData.system_expected_lbp,
        mockData.variance_usd,
        mockData.notes
      );

      expect(mockDbInstance.prepare.mock.results[1].value.run).toHaveBeenCalledWith(
          1, // user_id - as per dbHandlers.ts, it's hardcoded to 1
          'CREATE_DAILY_CLOSING',
          'daily_closings',
          101, // record_id
          JSON.stringify(mockData), // details_json
          expect.any(String) // created_at is CURRENT_TIMESTAMP
      );
    });

    it('should return success false on database error', async () => {
      (mockDbInstance.prepare as jest.Mock).mockImplementation(() => {
        return {
            run: jest.fn(() => { throw new Error('DB insert error'); }),
            all: jest.fn(), get: jest.fn(),
        };
      });

      const handler = ipcMain.handle.mock.calls.find(call => call[0] === 'closing:create-daily-closing')[1];
      const result = await handler({}, {}); // Pass empty data

      expect(result).toEqual({ success: false, error: 'DB insert error' });
    });
  });

  describe('closing:get-daily-stats-snapshot', () => {
    it('should return correct daily stats snapshot', async () => {
      const mockSalesStats = { sales_count: 5, total_sales_usd: 500, total_sales_lbp: 750000 };
      const mockDebtPayments = { total_debt_payments_usd: 50, total_debt_payments_lbp: 100000 };
      const mockExpensesStats = { total_expenses_usd: 20, total_expenses_lbp: 30000 };
      const mockProfitStats = { total_profit_usd: 150 };

      // Set up sequential get results for the prepare calls
      (mockDbInstance.prepare as jest.Mock)
        .mockImplementationOnce((sql) => ({ get: jest.fn(() => mockSalesStats), run: jest.fn(), all: jest.fn(), _sql: sql })) // sales stats
        .mockImplementationOnce((sql) => ({ get: jest.fn(() => mockDebtPayments), run: jest.fn(), all: jest.fn(), _sql: sql })) // debt payments
        .mockImplementationOnce((sql) => ({ get: jest.fn(() => mockExpensesStats), run: jest.fn(), all: jest.fn(), _sql: sql })) // expenses
        .mockImplementationOnce((sql) => ({ get: jest.fn(() => mockProfitStats), run: jest.fn(), all: jest.fn(), _sql: sql })); // profit

      const handler = ipcMain.handle.mock.calls.find(call => call[0] === 'closing:get-daily-stats-snapshot')[1];
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

    it('should handle null/zero stats gracefully', async () => {
        const mockNullStats = { sales_count: null, total_sales_usd: null, total_sales_lbp: null,
                               total_debt_payments_usd: null, total_debt_payments_lbp: null,
                               total_expenses_usd: null, total_expenses_lbp: null,
                               total_profit_usd: null };
        
        (mockDbInstance.prepare as jest.Mock)
            .mockImplementation((sql) => ({ get: jest.fn(() => mockNullStats), run: jest.fn(), all: jest.fn(), _sql: sql }));


        const handler = ipcMain.handle.mock.calls.find(call => call[0] === 'closing:get-daily-stats-snapshot')[1];
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

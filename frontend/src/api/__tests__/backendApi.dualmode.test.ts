// NOTE:
// These tests enforce a key invariant:
// - In Electron (window.api present), backendApi must NOT call fetch.
// - In Web (no window.api), backendApi may call fetch.

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as any;
}

describe('backendApi dual-mode routing', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    globalThis.fetch = originalFetch as any;
    jest.clearAllMocks();
  });

  it('in Electron mode: all exported functions route via window.api (no fetch)', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('fetch should not be called in Electron mode');
    }) as any;

    const apiStub: any = {
      // Auth
      login: jest.fn(async () => ({ success: true, user: { id: 1, username: 'admin', role: 'admin' }, sessionToken: 'tok' })),
      logout: jest.fn(async () => ({ success: true })),
      restoreSession: jest.fn(async () => ({ success: true, user: { id: 1, username: 'admin', role: 'admin' }, sessionToken: 'tok' })),

      // Clients
      getClients: jest.fn(async () => [{ id: 1 }]),
      deleteClient: jest.fn(async () => ({ success: true })),

      // Inventory
      getProducts: jest.fn(async () => [{ id: 1 }]),
      getLowStockProducts: jest.fn(async () => []),
      createProduct: jest.fn(async () => ({ success: true, id: 1 })),
      updateProduct: jest.fn(async () => ({ success: true })),
      deleteProduct: jest.fn(async () => ({ success: true })),
      getInventoryStockStats: jest.fn(async () => ({ stock_budget_usd: 1, stock_count: 1 })),

      // Sales
      getDrafts: jest.fn(async () => []),
      processSale: jest.fn(async () => ({ success: true, saleId: 1 })),
      getSale: jest.fn(async () => ({ id: 1 })),
      getSaleItems: jest.fn(async () => []),

      // Debts
      getDebtors: jest.fn(async () => []),
      getClientDebtHistory: jest.fn(async () => []),
      getClientDebtTotal: jest.fn(async () => 0),
      addRepayment: jest.fn(async () => ({ success: true })),

      // Exchange
      addExchangeTransaction: jest.fn(async () => ({ success: true, id: 1 })),
      getExchangeHistory: jest.fn(async () => []),
      currencies: {
        list: jest.fn(async () => []),
        create: jest.fn(async () => ({ success: true, id: 1 })),
        update: jest.fn(async () => ({ success: true })),
        delete: jest.fn(async () => ({ success: true })),
      },
      rates: {
        list: jest.fn(async () => []),
        set: jest.fn(async () => ({ success: true })),
      },

      // Expenses
      getTodayExpenses: jest.fn(async () => []),
      addExpense: jest.fn(async () => ({ success: true, id: 1 })),
      deleteExpense: jest.fn(async () => ({ success: true })),

      // Dashboard
      getDashboardStats: jest.fn(async () => ({ totalSalesUSD: 0 })),
      getProfitSalesChart: jest.fn(async () => []),
      getTodaysSales: jest.fn(async () => []),
      getDrawerBalances: jest.fn(async () => ({ generalDrawer: { usd: 0, lbp: 0 }, omtDrawer: { usd: 0, lbp: 0 } })),
      getDebtSummary: jest.fn(async () => ({ totalDebt: 0, topDebtors: [] })),
      getMonthlyPL: jest.fn(async () => ({ month: '2026-01' })),

      // Settings
      settings: {
        getAll: jest.fn(async () => [{ key_name: 'x', value: '1' }]),
        update: jest.fn(async () => ({ success: true })),
      },

      // Recharge
      getRechargeStock: jest.fn(async () => ({ mtc: 0, alfa: 0 })),
      processRecharge: jest.fn(async () => ({ success: true, saleId: 1 })),

      // Services
      getOMTHistory: jest.fn(async () => []),
      getOMTAnalytics: jest.fn(async () => ({ today: { commissionUSD: 0, commissionLBP: 0, count: 0 } })),
      addOMTTransaction: jest.fn(async () => ({ success: true, id: 1 })),

      // Maintenance
      getMaintenanceJobs: jest.fn(async () => []),
      saveMaintenanceJob: jest.fn(async () => ({ success: true, id: 1 })),
      deleteMaintenanceJob: jest.fn(async () => ({ success: true })),

      // Closing
      closing: {
        getSystemExpectedBalances: jest.fn(async () => ({})),
        hasOpeningBalanceToday: jest.fn(async () => true),
        getDailyStatsSnapshot: jest.fn(async () => ({})),
        setOpeningBalances: jest.fn(async () => ({ success: true })),
        createDailyClosing: jest.fn(async () => ({ success: true, id: 1 })),
        updateDailyClosing: jest.fn(async () => ({ success: true })),
      },

      // Suppliers
      listSuppliers: jest.fn(async () => []),
      getSupplierBalances: jest.fn(async () => []),
      getSupplierLedger: jest.fn(async () => []),
      createSupplier: jest.fn(async () => ({ success: true, id: 1 })),
      addSupplierLedgerEntry: jest.fn(async () => ({ success: true, id: 1 })),

      // Users
      getNonAdminUsers: jest.fn(async () => []),
      setUserActive: jest.fn(async () => ({ success: true })),
      setUserRole: jest.fn(async () => ({ success: true })),
      createUser: jest.fn(async () => ({ success: true, id: 1 })),
      setUserPassword: jest.fn(async () => ({ success: true })),

      // Activity
      activity: {
        getRecent: jest.fn(async () => []),
      },

      // Reports
      report: {
        generatePDF: jest.fn(async () => ({ success: true, path: '/tmp/x.pdf' })),
        backupDatabase: jest.fn(async () => ({ success: true, path: '/tmp/bak' })),
        listBackups: jest.fn(async () => ({ success: true, backups: [] })),
        verifyBackup: jest.fn(async () => ({ success: true, ok: true })),
        restoreDatabase: jest.fn(async () => ({ success: true })),
      },
    };

    (globalThis as any).window.api = apiStub;
    localStorage.setItem('sessionToken', 'tok');

    const apiMod = await import('../backendApi');

    // Invoke every export with a minimal argument set.
    await apiMod.login('admin', 'admin123', false);
    await apiMod.logout();
    await apiMod.me();

    await apiMod.getClients('');
    await apiMod.deleteClient(1);

    await apiMod.getProducts('');
    await apiMod.getLowStockProducts();
    await apiMod.createProduct({});
    await apiMod.updateProduct(1, {});
    await apiMod.deleteProduct(1);

    await apiMod.getDrafts();
    await apiMod.processSale({});
    await apiMod.getSale(1);
    await apiMod.getSaleItems(1);

    await apiMod.getDebtors();
    await apiMod.getClientDebtHistory(1);
    await apiMod.getClientDebtTotal(1);
    await apiMod.addRepayment({});

    await apiMod.getExchangeRates();
    await apiMod.getCurrenciesList();
    await apiMod.getExchangeHistory(10);
    await apiMod.addExchangeTransaction({});

    await apiMod.getTodayExpenses();
    await apiMod.addExpense({});
    await apiMod.deleteExpense(1);

    await apiMod.getDashboardStats();
    await apiMod.getProfitSalesChart('Sales');
    await apiMod.getTodaysSales();
    await apiMod.getDrawerBalances();
    await apiMod.getDebtSummary();
    await apiMod.getInventoryStockStats();
    await apiMod.getMonthlyPL('2026-01');

    await apiMod.getAllSettings();
    await apiMod.getSetting('x');
    await apiMod.updateSetting('x', '2');

    await apiMod.getRechargeStock();
    await apiMod.processRecharge({});

    await apiMod.getOMTHistory();
    await apiMod.getOMTAnalytics();
    await apiMod.addOMTTransaction({});

    await apiMod.getMaintenanceJobs();
    await apiMod.saveMaintenanceJob({});
    await apiMod.deleteMaintenanceJob(1);

    await apiMod.getCurrencies();

    await apiMod.getSystemExpectedBalances();
    await apiMod.hasOpeningBalanceToday();
    await apiMod.getDailyStatsSnapshot();
    await apiMod.setOpeningBalances({ closing_date: '2026-01-01', amounts: [] });
    await apiMod.createDailyClosing({ closing_date: '2026-01-01', amounts: [] });
    await apiMod.updateDailyClosing(1, {});

    await apiMod.getSuppliers('');
    await apiMod.getSupplierBalances();
    await apiMod.getSupplierLedger(1, 10);
    await apiMod.createSupplier({ name: 's' });
    await apiMod.addSupplierLedgerEntry(1, { entry_type: 'TOP_UP' });

    await apiMod.getRates();
    await apiMod.setRate('USD', 'LBP', 89000);

    await apiMod.getNonAdminUsers();
    await apiMod.createUser({ username: 'u', password: 'p', role: 'staff' });
    await apiMod.setUserActive(1, true);
    await apiMod.setUserRole(1, 'staff');
    await apiMod.setUserPassword(1, 'p');

    await apiMod.getRecentActivity(10);

    await apiMod.generatePDF('<html></html>');
    await apiMod.backupDatabase();
    await apiMod.listBackups();
    await apiMod.verifyBackup('/tmp/x');
    await apiMod.restoreDatabase('/tmp/x');

    await apiMod.createCurrency('EUR', 'Euro');
    await apiMod.updateCurrency(1, { name: 'Euro' });
    await apiMod.deleteCurrency(1);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('in Web mode: a representative call uses HTTP fetch', async () => {
    delete (globalThis as any).window.api;

    globalThis.fetch = jest.fn(async () => okJson({ success: true, users: [{ id: 1 }] })) as any;

    const apiMod = await import('../backendApi');
    await expect(apiMod.getNonAdminUsers()).resolves.toEqual([{ id: 1 }]);

    expect(globalThis.fetch).toHaveBeenCalled();
  });
});

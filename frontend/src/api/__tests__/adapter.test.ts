import type { ApiAdapter } from "@liratek/ui";

// Mock ALL backendApi exports so ElectronApiAdapter can bind to them.
// Any function not mocked here will be undefined and cause a clear test failure.
jest.mock("../backendApi", () => ({
  login: jest.fn(async () => ({ success: true })),
  logout: jest.fn(async () => undefined),
  me: jest.fn(async () => ({ success: true })),
  getClients: jest.fn(async () => []),
  deleteClient: jest.fn(async () => ({ success: true })),
  getProducts: jest.fn(async () => []),
  createProduct: jest.fn(async () => ({ success: true })),
  updateProduct: jest.fn(async () => ({ success: true })),
  deleteProduct: jest.fn(async () => ({ success: true })),
  getLowStockProducts: jest.fn(async () => []),
  getDrafts: jest.fn(async () => []),
  processSale: jest.fn(async () => ({ success: true })),
  getSale: jest.fn(async () => ({})),
  getSaleItems: jest.fn(async () => []),
  getDebtors: jest.fn(async () => []),
  getClientDebtHistory: jest.fn(async () => []),
  getClientDebtTotal: jest.fn(async () => 0),
  addRepayment: jest.fn(async () => ({ success: true })),
  getExchangeRates: jest.fn(async () => []),
  getCurrenciesList: jest.fn(async () => []),
  getExchangeHistory: jest.fn(async () => []),
  addExchangeTransaction: jest.fn(async () => ({ success: true })),
  getTodayExpenses: jest.fn(async () => []),
  addExpense: jest.fn(async () => ({ success: true })),
  deleteExpense: jest.fn(async () => ({ success: true })),
  getDashboardStats: jest.fn(async () => ({})),
  getProfitSalesChart: jest.fn(async () => []),
  getTodaysSales: jest.fn(async () => []),
  getDrawerBalances: jest.fn(async () => ({})),
  getDebtSummary: jest.fn(async () => ({})),
  getInventoryStockStats: jest.fn(async () => ({})),
  getMonthlyPL: jest.fn(async () => ({})),
  getDrawerNames: jest.fn(async () => []),
  getAllSettings: jest.fn(async () => []),
  getSetting: jest.fn(async () => null),
  updateSetting: jest.fn(async () => ({ success: true })),
  getRechargeStock: jest.fn(async () => []),
  processRecharge: jest.fn(async () => ({ success: true })),
  topUpRecharge: jest.fn(async () => ({ success: true })),
  getOMTHistory: jest.fn(async () => []),
  getOMTAnalytics: jest.fn(async () => ({})),
  addOMTTransaction: jest.fn(async () => ({ success: true })),
  getMaintenanceJobs: jest.fn(async () => []),
  saveMaintenanceJob: jest.fn(async () => ({ success: true })),
  deleteMaintenanceJob: jest.fn(async () => ({ success: true })),
  getCurrencies: jest.fn(async () => []),
  createCurrency: jest.fn(async () => ({ success: true })),
  updateCurrency: jest.fn(async () => ({ success: true })),
  deleteCurrency: jest.fn(async () => ({ success: true })),
  getSystemExpectedBalancesDynamic: jest.fn(async () => ({})),
  hasOpeningBalanceToday: jest.fn(async () => false),
  getDailyStatsSnapshot: jest.fn(async () => ({})),
  recalculateDrawerBalances: jest.fn(async () => ({ success: true })),
  setOpeningBalances: jest.fn(async () => ({ success: true })),
  createDailyClosing: jest.fn(async () => ({ success: true })),
  updateDailyClosing: jest.fn(async () => ({ success: true })),
  getSuppliers: jest.fn(async () => []),
  getSupplierBalances: jest.fn(async () => []),
  getSupplierLedger: jest.fn(async () => []),
  createSupplier: jest.fn(async () => ({ success: true })),
  addSupplierLedgerEntry: jest.fn(async () => ({ success: true })),
  getRates: jest.fn(async () => []),
  setRate: jest.fn(async () => ({ success: true })),
  getNonAdminUsers: jest.fn(async () => []),
  createUser: jest.fn(async () => ({ success: true })),
  setUserActive: jest.fn(async () => ({ success: true })),
  setUserRole: jest.fn(async () => ({ success: true })),
  setUserPassword: jest.fn(async () => ({ success: true })),
  getRecentActivity: jest.fn(async () => []),
  generatePDF: jest.fn(async () => ({ success: true })),
  backupDatabase: jest.fn(async () => ({ success: true })),
  listBackups: jest.fn(async () => ({ success: true, backups: [] })),
  verifyBackup: jest.fn(async () => ({ success: true })),
  restoreDatabase: jest.fn(async () => ({ success: true })),
  getModules: jest.fn(async () => []),
  getEnabledModules: jest.fn(async () => []),
  getToggleableModules: jest.fn(async () => []),
  setModuleEnabled: jest.fn(async () => ({ success: true })),
  getPaymentMethods: jest.fn(async () => []),
  getActivePaymentMethods: jest.fn(async () => []),
  createPaymentMethod: jest.fn(async () => ({ success: true })),
  updatePaymentMethod: jest.fn(async () => ({ success: true })),
  deletePaymentMethod: jest.fn(async () => ({ success: true })),
  reorderPaymentMethods: jest.fn(async () => ({ success: true })),
  getModulesForCurrency: jest.fn(async () => []),
  getCurrenciesByModule: jest.fn(async () => []),
  setModulesForCurrency: jest.fn(async () => ({ success: true })),
  getAllDrawerCurrencies: jest.fn(async () => ({})),
  getCurrenciesForDrawer: jest.fn(async () => []),
  getDrawersForCurrency: jest.fn(async () => []),
  setDrawerCurrencies: jest.fn(async () => ({ success: true })),
  getConfiguredDrawerNames: jest.fn(async () => []),
  startSession: jest.fn(async () => ({ success: true })),
  getActiveSession: jest.fn(async () => ({})),
  getSessionDetails: jest.fn(async () => ({})),
  updateSession: jest.fn(async () => ({ success: true })),
  closeSession: jest.fn(async () => ({ success: true })),
  listSessions: jest.fn(async () => ({ success: true, sessions: [] })),
  linkTransactionToSession: jest.fn(async () => ({
    success: true,
    linked: true,
  })),
  sendWhatsAppTestMessage: jest.fn(async () => ({ success: true })),
  sendWhatsAppMessage: jest.fn(async () => ({ success: true })),
}));

import { backendApiAdapter } from "../adapter";
import * as backendApi from "../backendApi";

describe("ElectronApiAdapter (via backendApiAdapter)", () => {
  it("satisfies the ApiAdapter interface", () => {
    const adapter: ApiAdapter = backendApiAdapter;
    expect(adapter).toBeDefined();
  });

  it("maps getClients(undefined) to getClients('')", async () => {
    await backendApiAdapter.getClients();
    expect(backendApi.getClients).toHaveBeenCalledWith("");
  });

  it("maps getProducts(undefined) to getProducts('')", async () => {
    await backendApiAdapter.getProducts();
    expect(backendApi.getProducts).toHaveBeenCalledWith("");
  });

  it("delegates setRate with single object argument", async () => {
    const data = {
      to_code: "LBP",
      market_rate: 89500,
      delta: 0,
      is_stronger: -1 as const,
    };
    await backendApiAdapter.setRate(data);
    expect(backendApi.setRate).toHaveBeenCalledWith(data);
  });

  it("delegates createSupplier correctly", async () => {
    const data = { name: "Test Supplier", phone: "+961123456" };
    await backendApiAdapter.createSupplier(data);
    expect(backendApi.createSupplier).toHaveBeenCalledWith(data);
  });

  it("delegates sendWhatsAppTestMessage with both args", async () => {
    await backendApiAdapter.sendWhatsAppTestMessage("81077357", "LiraTek");
    expect(backendApi.sendWhatsAppTestMessage).toHaveBeenCalledWith(
      "81077357",
      "LiraTek",
    );
  });

  // Verify every ApiAdapter method is wired (not undefined)
  it("has all ApiAdapter methods defined as functions", () => {
    const adapter = backendApiAdapter as unknown as Record<string, unknown>;
    const expectedMethods = [
      "login",
      "logout",
      "me",
      "getClients",
      "deleteClient",
      "getProducts",
      "createProduct",
      "updateProduct",
      "deleteProduct",
      "getLowStockProducts",
      "getDrafts",
      "processSale",
      "getSale",
      "getSaleItems",
      "getDebtors",
      "getClientDebtHistory",
      "getClientDebtTotal",
      "addRepayment",
      "getExchangeRates",
      "getCurrenciesList",
      "getExchangeHistory",
      "addExchangeTransaction",
      "getTodayExpenses",
      "addExpense",
      "deleteExpense",
      "getDashboardStats",
      "getProfitSalesChart",
      "getTodaysSales",
      "getDrawerBalances",
      "getDebtSummary",
      "getInventoryStockStats",
      "getMonthlyPL",
      "getDrawerNames",
      "getAllSettings",
      "getSetting",
      "updateSetting",
      "getRechargeStock",
      "processRecharge",
      "topUpRecharge",
      "getOMTHistory",
      "getOMTAnalytics",
      "addOMTTransaction",
      "getMaintenanceJobs",
      "saveMaintenanceJob",
      "deleteMaintenanceJob",
      "getCurrencies",
      "createCurrency",
      "updateCurrency",
      "deleteCurrency",
      "getSystemExpectedBalancesDynamic",
      "hasOpeningBalanceToday",
      "getDailyStatsSnapshot",
      "recalculateDrawerBalances",
      "setOpeningBalances",
      "createDailyClosing",
      "updateDailyClosing",
      "getSuppliers",
      "getSupplierBalances",
      "getSupplierLedger",
      "createSupplier",
      "addSupplierLedgerEntry",
      "getRates",
      "setRate",
      "getNonAdminUsers",
      "createUser",
      "setUserActive",
      "setUserRole",
      "setUserPassword",
      "getRecentActivity",
      "generatePDF",
      "backupDatabase",
      "listBackups",
      "verifyBackup",
      "restoreDatabase",
      "getModules",
      "getEnabledModules",
      "getToggleableModules",
      "setModuleEnabled",
      "getPaymentMethods",
      "getActivePaymentMethods",
      "createPaymentMethod",
      "updatePaymentMethod",
      "deletePaymentMethod",
      "reorderPaymentMethods",
      "getModulesForCurrency",
      "getCurrenciesByModule",
      "setModulesForCurrency",
      "getAllDrawerCurrencies",
      "getCurrenciesForDrawer",
      "getDrawersForCurrency",
      "setDrawerCurrencies",
      "getConfiguredDrawerNames",
      "startSession",
      "getActiveSession",
      "getSessionDetails",
      "updateSession",
      "closeSession",
      "listSessions",
      "linkTransactionToSession",
      "sendWhatsAppTestMessage",
      "sendWhatsAppMessage",
    ];

    for (const method of expectedMethods) {
      expect(typeof adapter[method]).toBe("function");
    }
  });
});

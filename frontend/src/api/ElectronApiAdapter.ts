/**
 * ElectronApiAdapter — implements the @liratek/ui ApiAdapter interface by
 * delegating every call to the existing backendApi.ts functions.
 *
 * This is a thin shim: it does NOT duplicate ipcOrHttp logic.
 * All transport branching stays in backendApi.ts (the "dual-mode facade").
 */

import type { ApiAdapter } from "@liratek/ui";
import * as api from "./backendApi";

export class ElectronApiAdapter implements ApiAdapter {
  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  login = (username: string, password: string, rememberMe?: boolean) =>
    api.login(username, password, rememberMe);
  logout = () => api.logout();
  me = () => api.me();

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  getClients = (search?: string) => api.getClients(search ?? "");
  deleteClient = (id: number) => api.deleteClient(id);

  // ---------------------------------------------------------------------------
  // Inventory / Products
  // ---------------------------------------------------------------------------
  getProducts = (search?: string) => api.getProducts(search ?? "");
  createProduct = (payload: any) => api.createProduct(payload);
  updateProduct = (id: number, payload: any) => api.updateProduct(id, payload);
  deleteProduct = (id: number) => api.deleteProduct(id);
  getLowStockProducts = () => api.getLowStockProducts();

  // ---------------------------------------------------------------------------
  // Sales
  // ---------------------------------------------------------------------------
  getDrafts = () => api.getDrafts();
  deleteDraft = (saleId: number) => api.deleteDraft(saleId);
  processSale = (payload: any) => api.processSale(payload);
  getSale = (saleId: number) => api.getSale(saleId);
  getSaleItems = (saleId: number) => api.getSaleItems(saleId);

  // ---------------------------------------------------------------------------
  // Debts
  // ---------------------------------------------------------------------------
  getDebtors = () => api.getDebtors();
  getClientDebtHistory = (clientId: number) =>
    api.getClientDebtHistory(clientId);
  getClientDebtTotal = (clientId: number) => api.getClientDebtTotal(clientId);
  addRepayment = (payload: any) => api.addRepayment(payload);

  // ---------------------------------------------------------------------------
  // Exchange
  // ---------------------------------------------------------------------------
  getExchangeRates = () => api.getExchangeRates();
  getCurrenciesList = () => api.getCurrenciesList();
  getExchangeHistory = (limit?: number) => api.getExchangeHistory(limit);
  addExchangeTransaction = (payload: any) =>
    api.addExchangeTransaction(payload);

  // ---------------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------------
  getTodayExpenses = () => api.getTodayExpenses();
  addExpense = (payload: any) => api.addExpense(payload);
  deleteExpense = (id: number) => api.deleteExpense(id);

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  getDashboardStats = () => api.getDashboardStats();
  getProfitSalesChart = (type: "Sales" | "Profit") =>
    api.getProfitSalesChart(type);
  getTodaysSales = () => api.getTodaysSales();
  getDrawerBalances = () => api.getDrawerBalances();
  getDebtSummary = () => api.getDebtSummary();
  getInventoryStockStats = () => api.getInventoryStockStats();
  getMonthlyPL = (month: string) => api.getMonthlyPL(month);
  getDrawerNames = () => api.getDrawerNames();

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  getAllSettings = () => api.getAllSettings();
  getSetting = (key: string) => api.getSetting(key);
  updateSetting = (key: string, value: string) => api.updateSetting(key, value);

  // ---------------------------------------------------------------------------
  // Recharge
  // ---------------------------------------------------------------------------
  getRechargeStock = () => api.getRechargeStock();
  processRecharge = (payload: any) => api.processRecharge(payload);
  topUpRecharge = (payload: {
    provider: "MTC" | "Alfa";
    amount: number;
    currency?: string;
  }) => api.topUpRecharge(payload);
  topUpApp = (payload: {
    provider: "OMT_APP" | "WHISH_APP" | "iPick" | "Katsh";
    amount: number;
    currency: "USD" | "LBP";
    sourceDrawer: string;
  }) => api.topUpApp(payload);

  // ---------------------------------------------------------------------------
  // Services (OMT / Whish / BOB)
  // ---------------------------------------------------------------------------
  getOMTHistory = (provider?: string) => api.getOMTHistory(provider);
  getOMTAnalytics = () => api.getOMTAnalytics();
  addOMTTransaction = (payload: any) => api.addOMTTransaction(payload);

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------
  getMaintenanceJobs = (statusFilter?: string) =>
    api.getMaintenanceJobs(statusFilter);
  saveMaintenanceJob = (payload: any) => api.saveMaintenanceJob(payload);
  deleteMaintenanceJob = (id: number) => api.deleteMaintenanceJob(id);

  // ---------------------------------------------------------------------------
  // Currencies (CRUD)
  // ---------------------------------------------------------------------------
  getCurrencies = () => api.getCurrencies();
  createCurrency = (
    code: string,
    name: string,
    symbol?: string,
    decimalPlaces?: number,
  ) => api.createCurrency(code, name, symbol, decimalPlaces);
  updateCurrency = (id: number, data: any) => api.updateCurrency(id, data);
  deleteCurrency = (id: number) => api.deleteCurrency(id);

  // ---------------------------------------------------------------------------
  // Closing
  // ---------------------------------------------------------------------------
  getSystemExpectedBalancesDynamic = () =>
    api.getSystemExpectedBalancesDynamic();
  hasOpeningBalanceToday = () => api.hasOpeningBalanceToday();
  getDailyStatsSnapshot = () => api.getDailyStatsSnapshot();
  recalculateDrawerBalances = () => api.recalculateDrawerBalances();
  setOpeningBalances = (data: {
    closing_date: string;
    amounts: any[];
    user_id?: number;
  }) => api.setOpeningBalances(data);
  createDailyClosing = (data: {
    closing_date: string;
    amounts: any[];
    variance_notes?: string;
    report_path?: string;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    user_id?: number;
  }) => api.createDailyClosing(data);
  updateDailyClosing = (id: number, data: any) =>
    api.updateDailyClosing(id, data);

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------
  getSuppliers = (search?: string) => api.getSuppliers(search);
  getSupplierBalances = () => api.getSupplierBalances();
  getSupplierLedger = (supplierId: number, limit?: number) =>
    api.getSupplierLedger(supplierId, limit);
  createSupplier = (data: {
    name: string;
    contact_name?: string;
    phone?: string;
    note?: string;
    module_key?: string;
    provider?: string;
  }) => api.createSupplier(data);
  addSupplierLedgerEntry = (supplierId: number, data: any) =>
    api.addSupplierLedgerEntry(supplierId, data);
  getUnsettledTransactions = (provider: string) =>
    api.getUnsettledTransactions(provider);
  settleTransactions = (data: any) => api.settleTransactions(data);

  // ---------------------------------------------------------------------------
  // Rates
  // ---------------------------------------------------------------------------
  getRates = () => api.getRates();
  setRate = (data: {
    to_code: string;
    market_rate: number;
    buy_rate: number;
    sell_rate: number;
    is_stronger: 1 | -1;
  }) => api.setRate(data);
  deleteRate = (to_code: string) => api.deleteRate(to_code);

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  getNonAdminUsers = () => api.getNonAdminUsers();
  createUser = (data: { username: string; password: string; role: string }) =>
    api.createUser(data);
  setUserActive = (userId: number, is_active: boolean) =>
    api.setUserActive(userId, is_active);
  setUserRole = (userId: number, role: string) => api.setUserRole(userId, role);
  setUserPassword = (userId: number, password: string) =>
    api.setUserPassword(userId, password);

  // ---------------------------------------------------------------------------
  // Activity
  // ---------------------------------------------------------------------------
  getRecentActivity = (limit?: number) => api.getRecentActivity(limit);

  // ---------------------------------------------------------------------------
  // Transactions (unified)
  // ---------------------------------------------------------------------------
  getRecentTransactions = (
    limit?: number,
    filters?: api.TransactionFiltersParam,
  ) => api.getRecentTransactions(limit, filters);
  getTransactionById = (id: number) => api.getTransactionById(id);
  getClientTransactions = (clientId: number, limit?: number) =>
    api.getClientTransactions(clientId, limit);
  voidTransaction = (id: number) => api.voidTransaction(id);
  refundTransaction = (id: number) => api.refundTransaction(id);
  getTransactionDailySummary = (date: string) =>
    api.getTransactionDailySummary(date);
  getDebtAging = (clientId: number) => api.getDebtAging(clientId);
  getOverdueDebts = () => api.getOverdueDebts();
  getRevenueByType = (from: string, to: string) =>
    api.getRevenueByType(from, to);
  getRevenueByUser = (from: string, to: string) =>
    api.getRevenueByUser(from, to);

  // ---------------------------------------------------------------------------
  // Reporting (aggregated analytics)
  // ---------------------------------------------------------------------------
  getDailySummaries = (from: string, to: string) =>
    api.getDailySummaries(from, to);
  getClientHistory = (clientId: number, limit?: number) =>
    api.getClientHistory(clientId, limit);
  getRevenueByModule = (from: string, to: string) =>
    api.getRevenueByModule(from, to);
  getReportOverdueDebts = () => api.getReportOverdueDebts();

  // ---------------------------------------------------------------------------
  // Profits (admin analytics)
  // ---------------------------------------------------------------------------
  getProfitSummary = (from: string, to: string) =>
    api.getProfitSummary(from, to);
  getProfitByModule = (from: string, to: string) =>
    api.getProfitByModule(from, to);
  getProfitByDate = (from: string, to: string) => api.getProfitByDate(from, to);
  getProfitByPaymentMethod = (from: string, to: string) =>
    api.getProfitByPaymentMethod(from, to);
  getProfitByUser = (from: string, to: string) => api.getProfitByUser(from, to);
  getProfitByClient = (from: string, to: string, limit?: number) =>
    api.getProfitByClient(from, to, limit);
  getPendingProfit = (from: string, to: string) =>
    api.getPendingProfit(from, to);

  // ---------------------------------------------------------------------------
  // Reports / Backup
  // ---------------------------------------------------------------------------
  generatePDF = (html: string, filename?: string) =>
    api.generatePDF(html, filename);
  backupDatabase = () => api.backupDatabase();
  listBackups = () => api.listBackups();
  verifyBackup = (path: string) => api.verifyBackup(path);
  restoreDatabase = (path: string) => api.restoreDatabase(path);

  // ---------------------------------------------------------------------------
  // Modules
  // ---------------------------------------------------------------------------
  getModules = () => api.getModules();
  getEnabledModules = () => api.getEnabledModules();
  getToggleableModules = () => api.getToggleableModules();
  setModuleEnabled = (key: string, enabled: boolean) =>
    api.setModuleEnabled(key, enabled);

  // ---------------------------------------------------------------------------
  // Payment Methods
  // ---------------------------------------------------------------------------
  getPaymentMethods = () => api.getPaymentMethods();
  getActivePaymentMethods = () => api.getActivePaymentMethods();
  createPaymentMethod = (data: {
    code: string;
    label: string;
    drawer_name: string;
    affects_drawer?: number;
  }) => api.createPaymentMethod(data);
  updatePaymentMethod = (id: number, data: any) =>
    api.updatePaymentMethod(id, data);
  deletePaymentMethod = (id: number) => api.deletePaymentMethod(id);
  reorderPaymentMethods = (ids: number[]) => api.reorderPaymentMethods(ids);

  // ---------------------------------------------------------------------------
  // Currency–Module & Currency–Drawer mapping
  // ---------------------------------------------------------------------------
  getModulesForCurrency = (code: string) => api.getModulesForCurrency(code);
  getCurrenciesByModule = (moduleKey: string) =>
    api.getCurrenciesByModule(moduleKey);
  getFullCurrenciesByDrawer = (drawerName: string) =>
    api.getFullCurrenciesByDrawer(drawerName);
  setModulesForCurrency = (code: string, modules: string[]) =>
    api.setModulesForCurrency(code, modules);
  getAllDrawerCurrencies = () => api.getAllDrawerCurrencies();
  getCurrenciesForDrawer = (drawerName: string) =>
    api.getCurrenciesForDrawer(drawerName);
  getDrawersForCurrency = (code: string) => api.getDrawersForCurrency(code);
  setDrawerCurrencies = (drawerName: string, currencies: string[]) =>
    api.setDrawerCurrencies(drawerName, currencies);
  getConfiguredDrawerNames = () => api.getConfiguredDrawerNames();

  // ---------------------------------------------------------------------------
  // Customer Sessions
  // ---------------------------------------------------------------------------
  startSession = (data: {
    customer_name: string;
    customer_phone?: string;
    customer_notes?: string;
  }) => api.startSession(data);
  getActiveSession = () => api.getActiveSession();
  getSessionDetails = (sessionId: number) => api.getSessionDetails(sessionId);
  updateSession = (sessionId: number, data: any) =>
    api.updateSession(sessionId, data);
  closeSession = (sessionId: number) => api.closeSession(sessionId);
  listSessions = (limit?: number, offset?: number) =>
    api.listSessions(limit, offset);
  linkTransactionToSession = (data: {
    sessionId: number;
    transactionType: string;
    transactionId: number;
    amountUsd: number;
    amountLbp: number;
  }) => api.linkTransactionToSession(data);

  // ---------------------------------------------------------------------------
  // WhatsApp
  // ---------------------------------------------------------------------------
  sendWhatsAppTestMessage = (recipientPhone: string, shopName: string) =>
    api.sendWhatsAppTestMessage(recipientPhone, shopName);
  sendWhatsAppMessage = (recipientPhone: string, message: string) =>
    api.sendWhatsAppMessage(recipientPhone, message);

  // ---------------------------------------------------------------------------
  // Item Costs
  // ---------------------------------------------------------------------------
  getItemCosts = () => api.getItemCosts();
  setItemCost = (data: {
    provider: string;
    category: string;
    itemKey: string;
    cost: number;
    currency: string;
  }) => api.setItemCost(data);

  // ---------------------------------------------------------------------------
  // Voucher Images
  // ---------------------------------------------------------------------------
  getVoucherImages = () => api.getVoucherImages();
  setVoucherImage = (data: {
    provider: string;
    category: string;
    itemKey: string;
    imageData: string;
  }) => api.setVoucherImage(data);
  deleteVoucherImage = (id: number) => api.deleteVoucherImage(id);

  // ---------------------------------------------------------------------------
  // Custom Services
  // ---------------------------------------------------------------------------
  getCustomServices = (filter?: { date?: string }) =>
    api.getCustomServices(filter);
  getCustomServicesSummary = () => api.getCustomServicesSummary();
  getCustomServiceById = (id: number) => api.getCustomServiceById(id);
  addCustomService = (data: {
    description: string;
    cost_usd?: number;
    cost_lbp?: number;
    price_usd?: number;
    price_lbp?: number;
    paid_by?: string;
    status?: string;
    client_id?: number;
    client_name?: string;
    phone_number?: string;
    note?: string;
  }) => api.addCustomService(data);
  deleteCustomService = (id: number) => api.deleteCustomService(id);

  // ---------------------------------------------------------------------------
  // Loto
  // ---------------------------------------------------------------------------
  loto = {
    sell: (data: any) => api.lotoSell(data),
    get: (id: number) => api.lotoGet(id),
    getByDateRange: (from: string, to: string) =>
      api.lotoGetByDateRange(from, to),
    getUncheckpointed: () => api.lotoGetUncheckpointed(),
    update: (id: number, data: any) => api.lotoUpdate(id, data),
    report: (from: string, to: string) => api.lotoReport(from, to),
    settlement: (from: string, to: string) => api.lotoSettlement(from, to),
    checkpoint: {
      create: (data: any) => api.lotoCheckpointCreate(data),
      get: (id: number) => api.lotoCheckpointGet(id),
      getByDate: (date: string) => api.lotoCheckpointGetByDate(date),
      getByDateRange: (from: string, to: string) =>
        api.lotoCheckpointGetByDateRange(from, to),
      getUnsettled: () => api.lotoCheckpointGetUnsettled(),
      update: (id: number, data: any) => api.lotoCheckpointUpdate(id, data),
      markSettled: (id: number, settledAt?: string, settlementId?: number) =>
        api.lotoCheckpointMarkSettled(id, settledAt, settlementId),
      settle: (data: {
        id: number;
        totalSales: number;
        totalCommission: number;
        totalPrizes: number;
        totalCashPrizes?: number;
        settledAt?: string;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
      }) => api.lotoCheckpointSettle(data),
      getTotalSalesUnsettled: () => api.lotoCheckpointGetTotalSalesUnsettled(),
      getTotalCommissionUnsettled: () =>
        api.lotoCheckpointGetTotalCommissionUnsettled(),
      getLast: () => api.lotoCheckpointGetLast(),
      createScheduled: (checkpointDate?: string) =>
        api.lotoCheckpointCreateScheduled(checkpointDate),
      delete: (id: number) => api.lotoCheckpointDelete(id),
    },
    cashPrize: {
      create: (data: any) => api.lotoCashPrizeCreate(data),
      getByDateRange: (from: string, to: string) =>
        api.lotoCashPrizeGetByDateRange(from, to),
      getUnreimbursed: () => api.lotoCashPrizeGetUnreimbursed(),
      markReimbursed: (
        id: number,
        reimbursedDate?: string,
        settlementId?: number,
      ) => api.lotoCashPrizeMarkReimbursed(id, reimbursedDate, settlementId),
      getTotalUnreimbursed: () => api.lotoCashPrizeGetTotalUnreimbursed(),
    },
    fees: {
      create: (data: any) => api.lotoFeesCreate(data),
      get: (year: number) => api.lotoFeesGet(year),
      pay: (id: number) => api.lotoFeesPay(id),
    },
    settings: {
      get: () => api.lotoSettingsGet(),
      update: (key: string, value: string) =>
        api.lotoSettingsUpdate(key, value),
    },
  };
}

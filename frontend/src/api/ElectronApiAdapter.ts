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
  createClient = (payload: {
    full_name: string;
    phone_number?: string;
    whatsapp_opt_in?: number | boolean;
    [key: string]: unknown;
  }) => api.createClient(payload);
  deleteClient = (id: number) => api.deleteClient(id);

  // ---------------------------------------------------------------------------
  // Inventory / Products
  // ---------------------------------------------------------------------------
  getProducts = (search?: string) => api.getProducts(search ?? "");
  createProduct = (payload: any) => api.createProduct(payload);
  updateProduct = (id: number, payload: any) => api.updateProduct(id, payload);
  deleteProduct = (id: number) => api.deleteProduct(id);
  getLowStockProducts = () => api.getLowStockProducts();
  adjustStock = (payload: {
    id: number;
    newQuantity?: number;
    delta?: number;
    reason: string;
  }) => api.adjustStock(payload);
  getStockAdjustments = (productId?: number) =>
    api.getStockAdjustments(productId);

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
  debtWriteOff = (payload: {
    clientId: number;
    amountUSD: number;
    amountLBP: number;
    reason?: string;
  }) => api.debtWriteOff(payload);
  getClientBalance = (clientId: number) => api.getClientBalance(clientId);
  cashOut = (payload: any) => api.debtCashOut(payload);
  addAccountEntry = (payload: any) => api.debtAccountEntry(payload);
  consumeCredit = (payload: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note?: string;
    transactionTime?: string;
  }) => api.debtUseCredit(payload);
  updateDebtMetadata = (payload: { id: number; note?: string }) =>
    api.debtUpdateMetadata(payload);

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
  getOMTAnalytics = (providers?: string[]) => api.getOMTAnalytics(providers);
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
  updateDailyClosing = (id: number, data: any) =>
    api.updateDailyClosing(id, data);
  createCheckpoint = (data: {
    user_id: number;
    drawer_name: string;
    notes?: string;
    report_path?: string;
    amounts: Array<{
      drawer_name: string;
      currency_code: string;
      expected_amount: number;
      physical_amount: number;
    }>;
  }) => api.createCheckpoint(data);
  getCheckpointTimeline = (filters?: {
    date_from?: string;
    date_to?: string;
    type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
    drawer_name?: string;
    user_id?: number;
  }) => api.getCheckpointTimeline(filters);
  getInitialCheckpointDate = () => api.getInitialCheckpointDate();
  getLastCheckpointPerDrawer = () => api.getLastCheckpointPerDrawer();
  hasInitialBalancesSet = () => api.hasInitialBalancesSet();
  hasStartingCheckpoint = () => api.hasStartingCheckpoint();

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------
  getSuppliers = (search?: string, includeInactive?: boolean) =>
    api.getSuppliers(search, includeInactive);
  getSupplierBalances = (includeInactive?: boolean) =>
    api.getSupplierBalances(includeInactive);
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
  recordSupplierCashflow = (data: {
    supplier_id: number;
    direction: "PAY" | "RECEIVE";
    payments: Array<{ method: string; currency_code: string; amount: number }>;
    note?: string;
    exchange_rate?: number;
    discount?: { amount_usd: number; amount_lbp: number; reason?: string };
  }) => api.recordSupplierCashflow(data);
  supplierWriteOff = (data: {
    supplier_id: number;
    amount_usd: number;
    amount_lbp: number;
    reason?: string;
  }) => api.supplierWriteOff(data);
  getAllSupplierTransactions = (provider: string, limit?: number) =>
    api.getAllSupplierTransactions(provider, limit);
  getUnsettledSummary = () => api.getUnsettledSummary();
  getSupplierProductBalances = () => api.getSupplierProductBalances();
  getSupplierProductItems = (supplierId: number) =>
    api.getSupplierProductItems(supplierId);
  getSupplierPurchases = (supplierId: number) =>
    api.getSupplierPurchases(supplierId);
  createSupplierPurchase = (data: {
    supplier_id: number;
    total_usd: number;
    note?: string;
  }) => api.createSupplierPurchase(data);

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
  getTransactionBySource = (sourceTable: string, sourceId: number) =>
    api.getTransactionBySource(sourceTable, sourceId);
  getClientTransactions = (clientId: number, limit?: number) =>
    api.getClientTransactions(clientId, limit);
  voidTransaction = (id: number) => api.voidTransaction(id);
  refundTransaction = (id: number, refundLegs?: api.RefundLegOverride[]) =>
    api.refundTransaction(id, refundLegs);
  voidCheckoutGroup = (groupId: string) => api.voidCheckoutGroup(groupId);
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
  reorderModules = (orderedKeys: string[]) => api.reorderModules(orderedKeys);

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
  // Carrier Lines (LIRA W6.a — shop SIM-line tracking)
  // ---------------------------------------------------------------------------
  getActiveCarrierLines = (carrier: "alfa" | "mtc") =>
    api.getActiveCarrierLines(carrier);
  getAllActiveCarrierLines = () => api.getAllActiveCarrierLines();
  getAdminCarrierLines = () => api.getAdminCarrierLines();
  createCarrierLine = (data: {
    carrier: "alfa" | "mtc";
    phone_number: string;
    label?: string | null;
    credits?: number;
    validity_expires_at?: string | null;
    notes?: string | null;
  }) => api.createCarrierLine(data);
  updateCarrierLine = (
    id: number,
    data: {
      carrier?: "alfa" | "mtc";
      phone_number?: string;
      label?: string | null;
      credits?: number;
      validity_expires_at?: string | null;
      notes?: string | null;
      is_active?: number;
    },
  ) => api.updateCarrierLine(id, data);
  updateCarrierLineBalance = (
    id: number,
    data: { credits?: number; validity_expires_at?: string | null },
  ) => api.updateCarrierLineBalance(id, data);
  archiveCarrierLine = (id: number) => api.archiveCarrierLine(id);
  toggleCarrierLineActive = (id: number) => api.toggleCarrierLineActive(id);

  // ---------------------------------------------------------------------------
  // Mobile Service Items — admin (LIRA W6.b)
  // ---------------------------------------------------------------------------
  getAdminMobileServiceItems = () => api.getAdminMobileServiceItems();
  updateMobileServiceItem = (
    id: number,
    data: {
      label?: string;
      cost_lbp?: number;
      sell_lbp?: number;
      sort_order?: number;
      is_active?: number;
      validity_days?: number | null;
      credits?: number | null;
    },
  ) => api.updateMobileServiceItem(id, data);

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
    profitUsd?: number;
    profitLbp?: number;
  }) => api.linkTransactionToSession(data);

  // Nested namespace mirroring window.api.session — so the session page /
  // context call the SAME method names on desktop (IPC) and web (REST).
  session = {
    getActiveSessions: () => api.getActiveSessions(),
    getTodaySessions: () => api.getTodaySessions(),
    getTodayAllSessions: () => api.getTodayAllSessions(),
    getByDateRange: (from: string, to: string) =>
      api.getSessionsByDateRange(from, to),
    getByCustomer: (data: { customerName: string; customerPhone?: string }) =>
      api.getSessionsByCustomer(data),
    delete: (sessionId: number) => api.deleteSession(sessionId),
    getTransactions: (sessionId: number) => api.getSessionDetails(sessionId),
    cartGet: (sessionId: number) => api.sessionCartGet(sessionId),
    cartAdd: (
      sessionId: number,
      item: {
        item_id: string;
        module: string;
        label: string;
        amount: number;
        currency: string;
        form_data: string;
        ipc_channel: string;
        user_id?: number;
      },
    ) => api.sessionCartAdd(sessionId, item),
    cartRemove: (sessionId: number, itemId: string) =>
      api.sessionCartRemove(sessionId, itemId),
    cartClear: (sessionId: number) => api.sessionCartClear(sessionId),
    checkout: (data: unknown) => api.processSessionCheckout(data),
  };

  // Nested namespace mirroring window.api.holdMoney (dual-mode IPC/REST).
  holdMoney = {
    list: (filter?: { status?: "held" | "collected" }) =>
      api.holdMoneyList(filter),
    active: () => api.holdMoneyActive(),
    create: (data: {
      client_name: string;
      phone_number?: string;
      usd_amount?: number;
      lbp_amount?: number;
      notes?: string;
      transaction_time?: string;
    }) => api.holdMoneyCreate(data),
    collect: (id: number) => api.holdMoneyCollect(id),
  };

  // Nested namespace mirroring window.api.servicePresets (dual-mode IPC/REST).
  servicePresets = {
    list: (filter?: { category?: string; includeInactive?: boolean }) =>
      api.servicePresetsList(filter),
    create: (data: {
      name: string;
      category: string;
      cost_usd?: number;
      cost_lbp?: number;
      price_usd?: number;
      price_lbp?: number;
      is_active?: number;
      sort_order?: number;
    }) => api.servicePresetsCreate(data),
    update: (
      id: number,
      data: {
        name?: string;
        category?: string;
        cost_usd?: number;
        cost_lbp?: number;
        price_usd?: number;
        price_lbp?: number;
        is_active?: number;
        sort_order?: number;
      },
    ) => api.servicePresetsUpdate(id, data),
    delete: (id: number) => api.servicePresetsDelete(id),
  };

  // Nested namespace mirroring window.api.audit (dual-mode, read-only).
  audit = {
    getRecent: (limit?: number) => api.auditGetRecent(limit),
    search: (filters: {
      userId?: number;
      action?: string;
      entityType?: string;
      entityId?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }) => api.auditSearch(filters),
    getByEntity: (entityType: string, entityId: string) =>
      api.auditGetByEntity(entityType, entityId),
  };

  // Nested namespace mirroring window.api.partners (dual-mode IPC/REST).
  // Reads return raw values (array / statement object) to match the IPC
  // handlers; writes return the { success, data? } envelope.
  partners = {
    getAll: (includeInactive?: boolean) =>
      api.partnersGetAll(includeInactive ?? false),
    getById: (id: number) => api.partnersGetById(id),
    getAllBalances: (includeInactive?: boolean) =>
      api.partnersGetAllBalances(includeInactive ?? false),
    getBalance: (partnerId: number) => api.partnersGetBalance(partnerId),
    getLedger: (
      partnerId: number,
      filters?: {
        startDate?: string;
        endDate?: string;
        type?: string;
        mode?: "FOR" | "THROUGH";
        provider?: string;
        direction?: "DEBIT" | "CREDIT";
      },
    ) => api.partnersGetLedger(partnerId, filters),
    create: (data: {
      name: string;
      phone?: string;
      notes?: string;
      system_association?: string | null;
    }) => api.partnersCreate(data),
    update: (
      id: number,
      data: {
        name?: string;
        phone?: string;
        notes?: string;
        is_active?: number;
        system_association?: string | null;
      },
    ) => api.partnersUpdate(id, data),
    deactivate: (id: number) => api.partnersDeactivate(id),
    activate: (id: number) => api.partnersActivate(id),
    recordTransaction: (data: {
      partnerId: number;
      transactionType?: string;
      referenceTable?: string;
      referenceId?: number;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
      notes?: string;
    }) => api.partnersRecordTransaction(data),
    settle: (data: {
      partnerId: number;
      amount: number;
      currency: string;
      settlementMethod: string;
      notes?: string;
      discount?: { amount_usd: number; amount_lbp: number; reason?: string };
      /** CQ-11 — split-leg settlement (MultiPaymentInput). */
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
    }) => api.partnersSettle(data),
    writeOff: (data: {
      partnerId: number;
      amount_usd: number;
      amount_lbp: number;
      reason?: string;
    }) => api.partnerWriteOff(data),
  };

  // Nested namespace mirroring window.api.vouchers (dual-mode IPC/REST).
  // All channels return the service envelope directly.
  vouchers = {
    getAll: (filters?: { status?: string; clientId?: number }) =>
      api.vouchersGetAll(filters),
    create: (data: {
      clientId: number;
      amount: number;
      currency?: "USD" | "LBP";
      expiryDate?: string | null;
      note?: string | null;
    }) => api.vouchersCreate(data),
    validate: (code: string) => api.vouchersValidate(code),
    cancel: (id: number) => api.vouchersCancel(id),
  };

  // Nested namespace mirroring window.api.drawerTopUp (dual-mode).
  drawerTopUp = {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      /** External (Cash In) mode only — top-ups in currencies other than
       *  USD/LBP already enabled for the General drawer. Never sent by
       *  createFromDrawer (transfer mode). */
      extra_currencies?: { currency_code: string; amount: number }[];
    }) => api.drawerTopUpCreate(data),
    createFromDrawer: (data: {
      amount_usd: number;
      amount_lbp: number;
      source_drawer: string;
      notes?: string;
    }) => api.drawerTopUpCreateFromDrawer(data),
    /** Fund the OMT_System / Whish_System spendable float from any drawer
     *  holding a spendable balance (owner-confirmed 2026-07-29 float model). */
    fundSystem: (data: {
      targetDrawer: "OMT_System" | "Whish_System";
      fundingDrawer: string;
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      transaction_time?: string;
    }) => api.drawerTopUpFundSystem(data),
    getSourceDrawers: () => api.drawerTopUpSourceDrawers(),
    getHistory: (limit?: number) => api.drawerTopUpHistory(limit),
  };

  // Nested namespace mirroring window.api.drawerCashout (dual-mode).
  drawerCashout = {
    create: (data: { amount_usd: number; amount_lbp: number; notes: string }) =>
      api.drawerCashoutCreate(data),
    getHistory: (limit?: number) => api.drawerCashoutHistory(limit),
  };

  // Nested namespace mirroring window.api.walletExchange (dual-mode).
  walletExchange = {
    create: (data: {
      drawerName: "OMT_App" | "Whish_App";
      fromCurrency: "USD" | "LBP";
      toCurrency: "USD" | "LBP";
      amountIn: number;
      rate: number;
      note?: string;
    }) => api.walletExchangeCreate(data),
    getHistory: (drawerName?: "OMT_App" | "Whish_App", limit?: number) =>
      api.walletExchangeHistory(drawerName, limit),
  };

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
    category?: string;
    transaction_time?: string;
    partnerId?: number;
    partnerMode?: "FOR";
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
      settleBatch: (data: {
        checkpointIds: number[];
        totalSales: number;
        totalCommission: number;
        settledAt?: string;
        payment?: {
          method: string;
          drawer_name: string;
          currency_code: string;
          amount: number;
        };
      }) => api.lotoCheckpointSettleBatch(data),
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

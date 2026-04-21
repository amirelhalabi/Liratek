// =============================================================================
// Core Types (from @liratek/core repositories)
//
// ClientEntity is re-exported from ../types (sourced from @liratek/core).
// All other entity types used only by the adapter are declared here.
// =============================================================================

import type { ClientEntity } from "@liratek/core";

// Re-export so api consumers don't need a separate import
export type { ClientEntity };

export type ApiUser = {
  id: number;
  username: string;
  role: string;
};

export type DebtorSummary = {
  id: number;
  full_name: string;
  phone_number: string;
  total_debt: number;
  total_debt_usd: number;
  total_debt_lbp: number;
};

export type DebtLedgerEntity = {
  id: number;
  client_id: number;
  transaction_id: number | null;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
};

export type DashboardStats = {
  totalSalesUSD: number;
  totalSalesLBP: number;
  cashCollectedUSD: number;
  cashCollectedLBP: number;
  ordersCount: number;
  activeClients: number;
  lowStockCount: number;
};

export type ChartDataPoint = {
  date: string;
  usd?: number;
  lbp?: number;
  profit?: number;
};

export type RecentSale = {
  id: number;
  client_name: string | null;
  paid_usd: number;
  paid_lbp: number;
  created_at: string;
};

export type DrawerBalance = {
  usd: number;
  lbp: number;
};

export type DrawerBalances = {
  generalDrawer: DrawerBalance;
  omtDrawer: DrawerBalance;
};

export type StockStats = {
  stock_budget_usd: number;
  stock_count: number;
};

export type VirtualStock = {
  mtc: number;
  alfa: number;
};

export type MonthlyPL = {
  month: string;
  salesProfitUSD: number;
  serviceCommissionsUSD: number;
  serviceCommissionsLBP: number;
  serviceCommissionsByCurrency: Record<string, number>;
  expensesUSD: number;
  expensesLBP: number;
  netProfitUSD: number;
  netProfitLBP: number;
};

// =============================================================================
// API Result Types
// =============================================================================

export type ApiResult = {
  success: boolean;
  error?: string;
  id?: number;
};

export type ApiMeResult = ApiResult & {
  user?: ApiUser;
};

export type ProductWriteResult = {
  success: boolean;
  id?: number;
  error?: string;
  code?: string;
  suggested_barcode?: string;
};

export type ProcessSaleResult = {
  success: boolean;
  id?: number;
  error?: string;
};

export type PaymentMethodEntity = {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: number;
  sort_order: number;
  is_active: number;
  is_system: number;
  created_at: string;
};

// =============================================================================
// API Adapter Interface
//
// Mirrors the public surface of frontend/src/api/backendApi.ts so that
// UI components are decoupled from the transport layer (Electron IPC vs HTTP).
// =============================================================================

// =============================================================================
// Lotto API
// =============================================================================

export type LotoCheckpointApi = {
  create: (
    data: any,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  get: (
    id: number,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  getByDate: (
    date: string,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  getByDateRange: (
    from: string,
    to: string,
  ) => Promise<{ success: boolean; checkpoints?: any[]; error?: string }>;
  getUnsettled: () => Promise<{
    success: boolean;
    checkpoints?: any[];
    error?: string;
  }>;
  update: (
    id: number,
    data: any,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  markSettled: (
    id: number,
    settledAt?: string,
    settlementId?: number,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  settle: (data: {
    id: number;
    totalSales: number;
    totalCommission: number;
    totalPrizes: number;
    totalCashPrizes?: number; // DEPRECATED — now read from checkpoint
    settledAt?: string;
    payments?: Array<{ method: string; currency_code: string; amount: number }>;
  }) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  getTotalSalesUnsettled: () => Promise<{
    success: boolean;
    totalSales?: number;
    error?: string;
  }>;
  getTotalCommissionUnsettled: () => Promise<{
    success: boolean;
    totalCommission?: number;
    error?: string;
  }>;
  getLast: () => Promise<{
    success: boolean;
    checkpoint?: any;
    error?: string;
  }>;
  createScheduled: (
    checkpointDate?: string,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  delete: (id: number) => Promise<{ success: boolean; error?: string }>;
};

export type LotoCashPrizeApi = {
  create: (
    data: any,
  ) => Promise<{ success: boolean; prize?: any; error?: string }>;
  getByDateRange: (
    from: string,
    to: string,
  ) => Promise<{ success: boolean; prizes?: any[]; error?: string }>;
  getUnreimbursed: () => Promise<{
    success: boolean;
    prizes?: any[];
    error?: string;
  }>;
  markReimbursed: (
    id: number,
    reimbursedDate?: string,
    settlementId?: number,
  ) => Promise<{ success: boolean; prize?: any; error?: string }>;
  getTotalUnreimbursed: () => Promise<{
    success: boolean;
    total?: number;
    error?: string;
  }>;
};

export type LotoFeesApi = {
  create: (
    data: any,
  ) => Promise<{ success: boolean; fee?: any; error?: string }>;
  get: (
    year: number,
  ) => Promise<{ success: boolean; fees?: any[]; error?: string }>;
  pay: (id: number) => Promise<{ success: boolean; fee?: any; error?: string }>;
};

export type LotoSettingsApi = {
  get: () => Promise<{
    success: boolean;
    settings?: Record<string, string>;
    error?: string;
  }>;
  update: (
    key: string,
    value: string,
  ) => Promise<{ success: boolean; setting?: any; error?: string }>;
};

export type LotoApi = {
  sell: (
    data: any,
  ) => Promise<{ success: boolean; ticket?: any; error?: string }>;
  get: (
    id: number,
  ) => Promise<{ success: boolean; ticket?: any; error?: string }>;
  getByDateRange: (
    from: string,
    to: string,
  ) => Promise<{ success: boolean; tickets?: any[]; error?: string }>;
  getUncheckpointed: () => Promise<{
    success: boolean;
    tickets?: any[];
    error?: string;
  }>;
  update: (
    id: number,
    data: any,
  ) => Promise<{ success: boolean; ticket?: any; error?: string }>;
  report: (
    from: string,
    to: string,
  ) => Promise<{
    success: boolean;
    reportData?: {
      total_tickets: number;
      total_sales: number;
      total_commission: number;
      total_prizes: number;
      total_cash_prizes: number;
      outstanding_prizes: number;
      total_fees: number;
    };
    error?: string;
  }>;
  settlement: (
    from: string,
    to: string,
  ) => Promise<{
    success: boolean;
    settlement?: {
      totalSales: number;
      totalFees: number;
      totalCommission: number;
      totalPrizes: number;
      shopPaysSupplier: number;
      supplierPaysShop: number;
      netSettlement: number;
    };
    error?: string;
  }>;
  checkpoint: LotoCheckpointApi;
  cashPrize: LotoCashPrizeApi;
  fees: LotoFeesApi;
  settings: LotoSettingsApi;
};

export type ApiAdapter = {
  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  login: (
    username: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<ApiMeResult & { sessionToken?: string }>;
  logout: () => Promise<void>;
  me: () => Promise<ApiMeResult>;

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  getClients: (search?: string) => Promise<ClientEntity[]>;
  deleteClient: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Inventory / Products
  // ---------------------------------------------------------------------------
  getProducts: (search?: string) => Promise<any[]>;
  createProduct: (payload: any) => Promise<ProductWriteResult>;
  updateProduct: (id: number, payload: any) => Promise<ProductWriteResult>;
  deleteProduct: (id: number) => Promise<ProductWriteResult>;
  getLowStockProducts: () => Promise<any[]>;

  // ---------------------------------------------------------------------------
  // Sales
  // ---------------------------------------------------------------------------
  getDrafts: () => Promise<any[]>;
  deleteDraft: (
    saleId: number,
  ) => Promise<{ success: boolean; error?: string }>;
  processSale: (payload: any) => Promise<ProcessSaleResult>;
  getSale: (saleId: number) => Promise<any>;
  getSaleItems: (saleId: number) => Promise<any[]>;

  // ---------------------------------------------------------------------------
  // Debts
  // ---------------------------------------------------------------------------
  getDebtors: () => Promise<DebtorSummary[]>;
  getClientDebtHistory: (clientId: number) => Promise<DebtLedgerEntity[]>;
  getClientDebtTotal: (clientId: number) => Promise<number>;
  addRepayment: (payload: {
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    paid_amount_usd?: number;
    paid_amount_lbp?: number;
    drawer_name?: string;
    paidByMethod?: string;
    note?: string;
    user_id?: number;
    payments?: Array<{ method: string; currencyCode: string; amount: number }>;
  }) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Exchange
  // ---------------------------------------------------------------------------
  getExchangeRates: () => Promise<any[]>;
  getCurrenciesList: () => Promise<any[]>;
  getExchangeHistory: (limit?: number) => Promise<any[]>;
  addExchangeTransaction: (
    payload: any,
  ) => Promise<ApiResult & { id?: number }>;

  // ---------------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------------
  getTodayExpenses: () => Promise<any[]>;
  addExpense: (payload: any) => Promise<ApiResult & { id?: number }>;
  deleteExpense: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  getDashboardStats: () => Promise<DashboardStats>;
  getProfitSalesChart: (type: "Sales" | "Profit") => Promise<ChartDataPoint[]>;
  getTodaysSales: (date?: string) => Promise<RecentSale[]>;
  getDrawerBalances: () => Promise<DrawerBalances>;
  getDebtSummary: () => Promise<any>;
  getInventoryStockStats: () => Promise<StockStats>;
  getMonthlyPL: (month: string) => Promise<MonthlyPL>;
  getDrawerNames: () => Promise<string[]>;

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  getAllSettings: () => Promise<any[]>;
  getSetting: (key: string) => Promise<any>;
  updateSetting: (key: string, value: string) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Recharge
  // ---------------------------------------------------------------------------
  getRechargeStock: () => Promise<VirtualStock>;
  processRecharge: (payload: any) => Promise<ApiResult>;
  topUpRecharge: (payload: {
    provider: "MTC" | "Alfa";
    amount: number;
    currency?: string;
  }) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Services (OMT / Whish / BOB)
  // ---------------------------------------------------------------------------
  getOMTHistory: (provider?: string) => Promise<any[]>;
  getOMTAnalytics: () => Promise<any>;
  addOMTTransaction: (payload: any) => Promise<ApiResult & { id?: number }>;

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------
  getMaintenanceJobs: (statusFilter?: string) => Promise<any[]>;
  saveMaintenanceJob: (payload: any) => Promise<ApiResult & { id?: number }>;
  deleteMaintenanceJob: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Currencies (CRUD)
  // ---------------------------------------------------------------------------
  getCurrencies: () => Promise<any[]>;
  createCurrency: (
    code: string,
    name: string,
    symbol?: string,
    decimalPlaces?: number,
  ) => Promise<ApiResult & { id?: number }>;
  updateCurrency: (id: number, data: any) => Promise<ApiResult>;
  deleteCurrency: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Closing
  // ---------------------------------------------------------------------------
  getSystemExpectedBalancesDynamic: () => Promise<
    Record<string, Record<string, number>>
  >;
  hasOpeningBalanceToday: () => Promise<boolean>;
  getDailyStatsSnapshot: () => Promise<any>;
  recalculateDrawerBalances: () => Promise<ApiResult>;
  setOpeningBalances: (data: {
    closing_date: string;
    amounts: any[];
    user_id?: number;
  }) => Promise<ApiResult>;
  createDailyClosing: (data: {
    closing_date: string;
    amounts: any[];
    variance_notes?: string;
    report_path?: string;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    user_id?: number;
  }) => Promise<ApiResult & { id?: number }>;
  updateDailyClosing: (
    id: number,
    data: {
      physical_usd?: number;
      physical_lbp?: number;
      physical_eur?: number;
      system_expected_usd?: number;
      system_expected_lbp?: number;
      variance_usd?: number;
      notes?: string;
      report_path?: string;
      user_id?: number;
    },
  ) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------
  getSuppliers: (search?: string) => Promise<any[]>;
  getSupplierBalances: () => Promise<any[]>;
  getSupplierLedger: (supplierId: number, limit?: number) => Promise<any[]>;
  createSupplier: (data: {
    name: string;
    contact_name?: string;
    phone?: string;
    note?: string;
    module_key?: string;
    provider?: string;
  }) => Promise<ApiResult & { id?: number }>;
  addSupplierLedgerEntry: (
    supplierId: number,
    data: {
      entry_type: string;
      amount_usd?: number;
      amount_lbp?: number;
      note?: string;
      drawer_name?: string;
    },
  ) => Promise<ApiResult & { id?: number }>;
  getUnsettledTransactions: (provider: string) => Promise<any[]>;
  settleTransactions: (data: {
    supplier_id: number;
    financial_service_ids: number[];
    amount_usd: number;
    amount_lbp: number;
    commission_usd: number;
    commission_lbp: number;
    drawer_name: string;
    note?: string;
    payments?: Array<{ method: string; currency_code: string; amount: number }>;
  }) => Promise<ApiResult & { id?: number }>;

  // ---------------------------------------------------------------------------
  // Rates (new 4-column schema: to_code, market_rate, delta, is_stronger)
  // ---------------------------------------------------------------------------
  getRates: () => Promise<any[]>;
  setRate: (data: {
    to_code: string;
    market_rate: number;
    buy_rate: number;
    sell_rate: number;
    is_stronger: 1 | -1;
  }) => Promise<ApiResult>;
  deleteRate: (to_code: string) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  getNonAdminUsers: () => Promise<any[]>;
  createUser: (data: {
    username: string;
    password: string;
    role: string;
  }) => Promise<ApiResult & { id?: number }>;
  setUserActive: (userId: number, is_active: boolean) => Promise<ApiResult>;
  setUserRole: (userId: number, role: string) => Promise<ApiResult>;
  setUserPassword: (userId: number, password: string) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Activity
  // ---------------------------------------------------------------------------
  getRecentActivity: (limit?: number) => Promise<any[]>;

  // ---------------------------------------------------------------------------
  // Reports / Backup
  // ---------------------------------------------------------------------------
  generatePDF: (
    html: string,
    filename?: string,
  ) => Promise<ApiResult & { path?: string }>;
  backupDatabase: () => Promise<ApiResult & { path?: string }>;
  listBackups: () => Promise<ApiResult & { backups?: any[] }>;
  verifyBackup: (path: string) => Promise<ApiResult>;
  restoreDatabase: (path: string) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Modules
  // ---------------------------------------------------------------------------
  getModules: () => Promise<any[]>;
  getEnabledModules: () => Promise<any[]>;
  getToggleableModules: () => Promise<any[]>;
  setModuleEnabled: (key: string, enabled: boolean) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Payment Methods
  // ---------------------------------------------------------------------------
  getPaymentMethods: () => Promise<PaymentMethodEntity[]>;
  getActivePaymentMethods: () => Promise<PaymentMethodEntity[]>;
  createPaymentMethod: (data: {
    code: string;
    label: string;
    drawer_name: string;
    affects_drawer?: number;
  }) => Promise<ApiResult & { id?: number }>;
  updatePaymentMethod: (
    id: number,
    data: {
      label?: string;
      drawer_name?: string;
      affects_drawer?: number;
      is_active?: number;
      sort_order?: number;
    },
  ) => Promise<ApiResult>;
  deletePaymentMethod: (id: number) => Promise<ApiResult>;
  reorderPaymentMethods: (ids: number[]) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Currency–Module & Currency–Drawer mapping
  // ---------------------------------------------------------------------------
  getModulesForCurrency: (code: string) => Promise<string[]>;
  getCurrenciesByModule: (moduleKey: string) => Promise<any[]>;
  getFullCurrenciesByDrawer: (drawerName: string) => Promise<any[]>;
  setModulesForCurrency: (
    code: string,
    modules: string[],
  ) => Promise<ApiResult>;
  getAllDrawerCurrencies: () => Promise<Record<string, string[]>>;
  getCurrenciesForDrawer: (drawerName: string) => Promise<string[]>;
  getDrawersForCurrency: (code: string) => Promise<string[]>;
  setDrawerCurrencies: (
    drawerName: string,
    currencies: string[],
  ) => Promise<ApiResult>;
  getConfiguredDrawerNames: () => Promise<string[]>;

  // ---------------------------------------------------------------------------
  // Customer Sessions
  // ---------------------------------------------------------------------------
  startSession: (data: {
    customer_name: string;
    customer_phone?: string;
    customer_notes?: string;
  }) => Promise<ApiResult & { sessionId?: number }>;
  getActiveSession: () => Promise<any>;
  getSessionDetails: (sessionId: number) => Promise<any>;
  updateSession: (
    sessionId: number,
    data: {
      customer_name?: string;
      customer_phone?: string;
      customer_notes?: string;
    },
  ) => Promise<ApiResult>;
  closeSession: (sessionId: number) => Promise<ApiResult>;
  listSessions: (limit?: number, offset?: number) => Promise<any>;
  linkTransactionToSession: (data: {
    sessionId: number;
    transactionType: string;
    transactionId: number;
    amountUsd: number;
    amountLbp: number;
  }) => Promise<ApiResult & { linked: boolean }>;

  // ---------------------------------------------------------------------------
  // WhatsApp
  // ---------------------------------------------------------------------------
  sendWhatsAppTestMessage: (
    recipientPhone: string,
    shopName: string,
  ) => Promise<ApiResult & { messageId?: string }>;
  sendWhatsAppMessage: (
    recipientPhone: string,
    message: string,
  ) => Promise<ApiResult & { messageId?: string }>;

  // ---------------------------------------------------------------------------
  // Item Costs
  // ---------------------------------------------------------------------------
  getItemCosts: () => Promise<any[]>;
  setItemCost: (data: {
    provider: string;
    category: string;
    itemKey: string;
    cost: number;
    currency: string;
  }) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Voucher Images
  // ---------------------------------------------------------------------------
  getVoucherImages: () => Promise<any[]>;
  setVoucherImage: (data: {
    provider: string;
    category: string;
    itemKey: string;
    imageData: string;
  }) => Promise<ApiResult>;
  deleteVoucherImage: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Custom Services
  // ---------------------------------------------------------------------------
  getCustomServices: (filter?: { date?: string }) => Promise<any[]>;
  getCustomServicesSummary: () => Promise<{
    count: number;
    totalCostUsd: number;
    totalCostLbp: number;
    totalPriceUsd: number;
    totalPriceLbp: number;
    totalProfitUsd: number;
    totalProfitLbp: number;
  }>;
  getCustomServiceById: (id: number) => Promise<any>;
  addCustomService: (data: {
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
  }) => Promise<ApiResult & { id?: number }>;
  deleteCustomService: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Unified Transactions
  // ---------------------------------------------------------------------------
  getRecentTransactions: (
    limit?: number,
    filters?: Record<string, unknown>,
  ) => Promise<any[]>;
  getTransactionById: (id: number) => Promise<any>;
  getClientTransactions: (clientId: number, limit?: number) => Promise<any[]>;
  voidTransaction: (id: number) => Promise<ApiResult & { reversalId?: number }>;
  refundTransaction: (id: number) => Promise<ApiResult & { refundId?: number }>;
  getTransactionDailySummary: (date: string) => Promise<any>;
  getDebtAging: (clientId: number) => Promise<any>;
  getOverdueDebts: () => Promise<any[]>;
  getRevenueByType: (from: string, to: string) => Promise<any[]>;
  getRevenueByUser: (from: string, to: string) => Promise<any[]>;

  // ---------------------------------------------------------------------------
  // Reporting (aggregated analytics)
  // ---------------------------------------------------------------------------
  getDailySummaries: (from: string, to: string) => Promise<any[]>;
  getClientHistory: (clientId: number, limit?: number) => Promise<any>;
  getRevenueByModule: (from: string, to: string) => Promise<any[]>;
  getReportOverdueDebts: () => Promise<any[]>;

  // ---------------------------------------------------------------------------
  // Profits (admin analytics)
  // ---------------------------------------------------------------------------
  getProfitSummary: (from: string, to: string) => Promise<any>;
  getProfitByModule: (from: string, to: string) => Promise<any[]>;
  getProfitByDate: (from: string, to: string) => Promise<any[]>;
  getProfitByPaymentMethod: (from: string, to: string) => Promise<any[]>;
  getProfitByUser: (from: string, to: string) => Promise<any[]>;
  getProfitByClient: (
    from: string,
    to: string,
    limit?: number,
  ) => Promise<any[]>;
  getPendingProfit: (from: string, to: string) => Promise<any>;

  // ---------------------------------------------------------------------------
  // Loto
  // ---------------------------------------------------------------------------
  loto: LotoApi;
};

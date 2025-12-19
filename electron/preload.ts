import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  // Database operations
  getSettings: () => ipcRenderer.invoke("db:get-settings"),
  getSetting: (key: string) => ipcRenderer.invoke("db:get-setting", key),
  updateSetting: (key: string, value: string) =>
    ipcRenderer.invoke("db:update-setting", key, value),

  // Expenses
  addExpense: (data: { category: string; description?: string; amount: number; currency: 'USD' | 'LBP' }) => ipcRenderer.invoke("db:add-expense", data),
  getTodayExpenses: () => ipcRenderer.invoke("db:get-today-expenses"),
  deleteExpense: (id: number) => ipcRenderer.invoke("db:delete-expense", id),

  // Auth operations
  login: (username: string, password: string) =>
    ipcRenderer.invoke("auth:login", username, password),
  logout: (userId: number) => ipcRenderer.invoke("auth:logout", userId),
  restoreSession: () => ipcRenderer.invoke("auth:restore-session"),
  getCurrentUser: (userId: number) =>
    ipcRenderer.invoke("auth:get-current-user", userId),
  getNonAdminUsers: () => ipcRenderer.invoke("users:get-non-admins"),
  setUserActive: (id: number, is_active: number) =>
    ipcRenderer.invoke("users:set-active", { id, is_active }),
  setUserRole: (id: number, role: "admin" | "staff") =>
    ipcRenderer.invoke("users:set-role", { id, role }),
  createUser: (username: string, password: string, role: "admin" | "staff") =>
    ipcRenderer.invoke("users:create", { username, password, role }),
  setUserPassword: (id: number, password: string) =>
    ipcRenderer.invoke("users:set-password", { id, password }),

  // Inventory operations
  getProducts: (search?: string) =>
    ipcRenderer.invoke("inventory:get-products", search),
  getProduct: (id: number) => ipcRenderer.invoke("inventory:get-product", id),
  getProductByBarcode: (barcode: string) =>
    ipcRenderer.invoke("inventory:get-product-by-barcode", barcode),
  createProduct: (
    product: Omit<import("../src/types").Product, "id" | "created_at" | "is_active"> & { is_active?: number }
  ) => ipcRenderer.invoke("inventory:create-product", product),
  updateProduct: (
    product: Partial<import("../src/types").Product> & { id: number }
  ) => ipcRenderer.invoke("inventory:update-product", product),
  deleteProduct: (id: number) =>
    ipcRenderer.invoke("inventory:delete-product", id),
  adjustStock: (id: number, quantity: number) =>
    ipcRenderer.invoke("inventory:adjust-stock", id, quantity),
  getLowStockProducts: () =>
    ipcRenderer.invoke("inventory:get-low-stock-products"),
  getInventoryStockStats: () => ipcRenderer.invoke("inventory:get-stock-stats"),

  // Client operations
  getClients: (search?: string) =>
    ipcRenderer.invoke("clients:get-all", search),
  getClient: (id: number) => ipcRenderer.invoke("clients:get-one", id),
  createClient: (
    client: Omit<import("../src/types").Client, "id" | "created_at">
  ) => ipcRenderer.invoke("clients:create", client),
  updateClient: (
    client: Partial<import("../src/types").Client> & { id: number }
  ) => ipcRenderer.invoke("clients:update", client),
  deleteClient: (id: number) => ipcRenderer.invoke("clients:delete", id),

  // Sales operations
  processSale: (saleData: unknown) => ipcRenderer.invoke("sales:process", saleData),
  getDashboardStats: () => ipcRenderer.invoke("sales:get-dashboard-stats"),
  getDrawerBalances: () => ipcRenderer.invoke("dashboard:get-drawer-balances"),
  getProfitSalesChart: (type: "Sales" | "Profit") =>
    ipcRenderer.invoke("dashboard:get-profit-sales-chart", type),
  getDrafts: () => ipcRenderer.invoke("sales:get-drafts"),
  getTodaysSales: () => ipcRenderer.invoke("sales:get-todays-sales"),
  getTopProducts: () => ipcRenderer.invoke("sales:get-top-products"),

  // Debt
  getDebtSummary: () => ipcRenderer.invoke("dashboard:get-debt-summary"),
  getDebtors: () => ipcRenderer.invoke("debt:get-debtors"),
  getClientDebtHistory: (clientId: number) =>
    ipcRenderer.invoke("debt:get-client-history", clientId),
  getClientDebtTotal: (clientId: number) =>
    ipcRenderer.invoke("debt:get-client-total", clientId),
  addRepayment: (data: {
    clientId: number;
    amountUSD: number;
    amountLBP: number;
    note?: string;
    userId?: number;
  }) => ipcRenderer.invoke("debt:add-repayment", data),

  // Closing operations
  closing: {
    getSystemExpectedBalances: () =>
      ipcRenderer.invoke("closing:get-system-expected-balances"),
    createDailyClosing: (data: {
      closing_date: string;
      amounts: Array<{
        drawer_name: string;
        currency_code: string;
        physical_amount: number;
        opening_amount?: number;
      }>;
      user_id?: number;
      variance_notes?: string;
      report_path?: string;
    }) => ipcRenderer.invoke("closing:create-daily-closing", data),
    updateDailyClosing: (data: {
      id: number;
      physical_usd?: number;
      physical_lbp?: number;
      physical_eur?: number;
      system_expected_usd?: number;
      system_expected_lbp?: number;
      variance_usd?: number;
      notes?: string;
      report_path?: string;
      user_id?: number;
    }) => ipcRenderer.invoke("closing:update-daily-closing", data),
    getDailyStatsSnapshot: () =>
      ipcRenderer.invoke("closing:get-daily-stats-snapshot"),
    setOpeningBalances: (data: {
      closing_date: string;
      amounts: Array<{
        drawer_name: string;
        currency_code: string;
        opening_amount: number;
      }>;
    }) => ipcRenderer.invoke("closing:set-opening-balances", data),
  },

  // Settings operations
  settings: {
    getAll: () => ipcRenderer.invoke("settings:get-all"),
    update: (key: string, value: string) =>
      ipcRenderer.invoke("settings:update", key, value),
  },

  // Diagnostics
  diagnostics: {
    getSyncErrors: () => ipcRenderer.invoke("diagnostics:get-sync-errors"),
  },

  // Reports
  report: {
    generatePDF: (html: string, filename?: string) =>
      ipcRenderer.invoke("report:generate-pdf", { html, filename }),
    backupDatabase: () => ipcRenderer.invoke("report:backup-db"),
  },

  // Activity
  activity: {
    getRecent: (limit?: number) =>
      ipcRenderer.invoke("activity:get-recent", limit),
  },

  // Exchange
  addExchangeTransaction: (data: {
    fromCurrency: string;
    toCurrency: string;
    amountIn: number;
    amountOut: number;
    rate: number;
    clientName?: string;
    note?: string;
  }) => ipcRenderer.invoke("exchange:add-transaction", data),
  getExchangeHistory: () => ipcRenderer.invoke("exchange:get-history"),
  rates: {
    list: () => ipcRenderer.invoke("rates:list"),
    set: (from_code: string, to_code: string, rate: number) =>
      ipcRenderer.invoke("rates:set", { from_code, to_code, rate }),
  },

  // Currencies
  currencies: {
    list: () => ipcRenderer.invoke("currencies:list"),
    create: (code: string, name: string) =>
      ipcRenderer.invoke("currencies:create", { code, name }),
    update: (data: {
      id: number;
      code?: string;
      name?: string;
      is_active?: number;
    }) => ipcRenderer.invoke("currencies:update", data),
    delete: (id: number) => ipcRenderer.invoke("currencies:delete", id),
  },

  // OMT/Whish Financial Services
  addOMTTransaction: (data: {
    provider: "OMT" | "WHISH" | "BOB" | "OTHER";
    serviceType: "SEND" | "RECEIVE" | "BILL_PAYMENT";
    amountUSD: number;
    amountLBP: number;
    commissionUSD: number;
    commissionLBP: number;
    clientName?: string;
    referenceNumber?: string;
    note?: string;
  }) => ipcRenderer.invoke("omt:add-transaction", data),
  getOMTHistory: (provider?: string) =>
    ipcRenderer.invoke("omt:get-history", provider),
  getOMTAnalytics: () => ipcRenderer.invoke("omt:get-analytics"),

  // Recharge (Alfa/MTC)
  getRechargeStock: () => ipcRenderer.invoke("recharge:get-stock"),
  processRecharge: (data: unknown) => ipcRenderer.invoke("recharge:process", data),

  // Maintenance
  saveMaintenanceJob: (job: unknown) => ipcRenderer.invoke("maintenance:save", job),
  getMaintenanceJobs: (statusFilter?: string) =>
    ipcRenderer.invoke("maintenance:get-jobs", statusFilter),
  deleteMaintenanceJob: (id: number) =>
    ipcRenderer.invoke("maintenance:delete", id),
});

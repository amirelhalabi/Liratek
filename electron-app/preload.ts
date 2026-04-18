import { contextBridge, ipcRenderer, webFrame } from "electron";

console.log("[PRELOAD] Starting preload script...");

contextBridge.exposeInMainWorld("api", {
  // Auth & Users
  auth: {
    login: (username: string, password: string, rememberMe?: boolean) =>
      ipcRenderer.invoke("auth:login", username, password, rememberMe),
    logout: (sessionToken: string) =>
      ipcRenderer.invoke("auth:logout", sessionToken),
    restoreSession: (sessionToken?: string) =>
      ipcRenderer.invoke("auth:restore-session", sessionToken),
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
  },

  // Expenses
  expenses: {
    add: (data: {
      description: string;
      category: string;
      paid_by_method?: string;
      amount_usd: number;
      amount_lbp: number;
      expense_date: string;
    }) => ipcRenderer.invoke("db:add-expense", data),
    getToday: () => ipcRenderer.invoke("db:get-today-expenses"),
    delete: (id: number) => ipcRenderer.invoke("db:delete-expense", id),
  },

  // Inventory
  inventory: {
    getProducts: (search?: string) =>
      ipcRenderer.invoke("inventory:get-products", search),
    getProduct: (id: number) => ipcRenderer.invoke("inventory:get-product", id),
    getProductByBarcode: (barcode: string) =>
      ipcRenderer.invoke("inventory:get-product-by-barcode", barcode),
    createProduct: (product: unknown) =>
      ipcRenderer.invoke("inventory:create-product", product),
    updateProduct: (product: unknown) =>
      ipcRenderer.invoke("inventory:update-product", product),
    batchUpdate: (payload: unknown) =>
      ipcRenderer.invoke("inventory:batch-update", payload),
    deleteProduct: (id: number) =>
      ipcRenderer.invoke("inventory:delete-product", id),
    batchDelete: (ids: number[]) =>
      ipcRenderer.invoke("inventory:batch-delete", ids),
    adjustStock: (id: number, quantity: number) =>
      ipcRenderer.invoke("inventory:adjust-stock", id, quantity),
    getLowStockProducts: () =>
      ipcRenderer.invoke("inventory:get-low-stock-products"),
    getStockStats: () => ipcRenderer.invoke("inventory:get-stock-stats"),
    getCategories: () => ipcRenderer.invoke("inventory:get-categories"),
    getCategoriesFull: () =>
      ipcRenderer.invoke("inventory:get-categories-full"),
    createCategory: (name: string) =>
      ipcRenderer.invoke("inventory:create-category", name),
    updateCategory: (id: number, name: string) =>
      ipcRenderer.invoke("inventory:update-category", id, name),
    deleteCategory: (id: number) =>
      ipcRenderer.invoke("inventory:delete-category", id),
    getProductSuppliers: () =>
      ipcRenderer.invoke("inventory:get-product-suppliers"),
    getProductSuppliersFull: () =>
      ipcRenderer.invoke("inventory:get-product-suppliers-full"),
    createProductSupplier: (name: string) =>
      ipcRenderer.invoke("inventory:create-product-supplier", name),
    updateProductSupplier: (id: number, name: string) =>
      ipcRenderer.invoke("inventory:update-product-supplier", id, name),
    deleteProductSupplier: (id: number) =>
      ipcRenderer.invoke("inventory:delete-product-supplier", id),
  },

  // Clients
  clients: {
    getAll: (search?: string) => ipcRenderer.invoke("clients:get-all", search),
    get: (id: number) => ipcRenderer.invoke("clients:get-one", id),
    create: (client: unknown) => ipcRenderer.invoke("clients:create", client),
    update: (client: unknown) => ipcRenderer.invoke("clients:update", client),
    delete: (id: number) => ipcRenderer.invoke("clients:delete", id),
    importDebts: (data: unknown) =>
      ipcRenderer.invoke("clients:import-debts", data),
  },

  // Sales
  sales: {
    process: (saleData: unknown) =>
      ipcRenderer.invoke("sales:process", saleData),
    get: (saleId: number) => ipcRenderer.invoke("sales:get", saleId),
    getItems: (saleId: number) => ipcRenderer.invoke("sales:get-items", saleId),
    getDrafts: () => ipcRenderer.invoke("sales:get-drafts"),
    deleteDraft: (saleId: number) =>
      ipcRenderer.invoke("sales:delete-draft", saleId),
    getTodaysSales: (date?: string) =>
      ipcRenderer.invoke("sales:get-todays-sales", date),
    getTopProducts: () => ipcRenderer.invoke("sales:get-top-products"),
    refund: (saleId: number) => ipcRenderer.invoke("sales:refund", saleId),
    refundItem: (saleId: number, saleItemId: number, refundQuantity: number) =>
      ipcRenderer.invoke("sales:refund-item", {
        saleId,
        saleItemId,
        refundQuantity,
      }),
    getByDateRange: (startDate: string, endDate: string) =>
      ipcRenderer.invoke("sales:get-by-date-range", startDate, endDate),
  },

  // Dashboard
  dashboard: {
    getStats: () => ipcRenderer.invoke("sales:get-dashboard-stats"),
    getDrawerBalances: () =>
      ipcRenderer.invoke("dashboard:get-drawer-balances"),
    getProfitSalesChart: (type: "Sales" | "Profit") =>
      ipcRenderer.invoke("dashboard:get-profit-sales-chart", type),
  },

  // Debt
  debt: {
    getSummary: () => ipcRenderer.invoke("dashboard:get-debt-summary"),
    getDebtors: () => ipcRenderer.invoke("debt:get-debtors"),
    getClientHistory: (clientId: number) =>
      ipcRenderer.invoke("debt:get-client-history", clientId),
    getClientTotal: (clientId: number) =>
      ipcRenderer.invoke("debt:get-client-total", clientId),
    addRepayment: (data: {
      clientId: number;
      amountUSD: number;
      amountLBP: number;
      paidAmountUSD?: number | undefined;
      paidAmountLBP?: number | undefined;
      drawerName?: string | undefined;
      note?: string;
      userId?: number;
      paidByMethod?: string;
    }) => ipcRenderer.invoke("debt:add-repayment", data),
  },

  // Financial
  financial: {
    getMonthlyPL: (month: string) =>
      ipcRenderer.invoke("financial:get-monthly-pl", month),
    getDrawerNames: () => ipcRenderer.invoke("financial:get-drawer-names"),
  },

  // Exchange
  exchange: {
    addTransaction: (data: {
      fromCurrency: string;
      toCurrency: string;
      amountIn: number;
      amountOut: number;
      rate: number;
      clientName?: string;
      note?: string;
    }) => ipcRenderer.invoke("exchange:add-transaction", data),
    getHistory: () => ipcRenderer.invoke("exchange:get-history"),
  },

  // OMT/Whish Financial Services
  omt: {
    addTransaction: (data: {
      provider:
        | "OMT"
        | "WHISH"
        | "BOB"
        | "OTHER"
        | "iPick"
        | "Katsh"
        | "WISH_APP"
        | "OMT_APP";
      serviceType: "SEND" | "RECEIVE";
      amountUSD: number;
      amountLBP: number;
      commissionUSD: number;
      commissionLBP: number;
      clientName?: string;
      referenceNumber?: string;
      note?: string;
    }) => ipcRenderer.invoke("omt:add-transaction", data),
    getHistory: (provider?: string) =>
      ipcRenderer.invoke("omt:get-history", provider),
    getAnalytics: () => ipcRenderer.invoke("omt:get-analytics"),
    getById: (id: number) => ipcRenderer.invoke("omt:get-by-id", id),
    getPaymentsByTransaction: (transactionId: number) =>
      ipcRenderer.invoke("omt:get-payments-by-transaction", transactionId),
  },

  // Recharge (Alfa/MTC)
  recharge: {
    getStock: () => ipcRenderer.invoke("recharge:get-stock"),
    getHistory: (provider: "MTC" | "Alfa") =>
      ipcRenderer.invoke("recharge:get-history", provider),
    getDrawerBalances: () => ipcRenderer.invoke("recharge:get-drawer-balances"),
    process: (data: {
      provider: "MTC" | "Alfa";
      type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
      amount: number;
      cost: number;
      price: number;
      paid_by_method?: string;
      phoneNumber?: string;
    }) => ipcRenderer.invoke("recharge:process", data),
    topUp: (data: {
      provider: "MTC" | "Alfa";
      amount: number;
      currency?: string;
    }) => ipcRenderer.invoke("recharge:top-up", data),
    topUpApp: (data: {
      provider: "OMT_APP" | "WHISH_APP";
      amount: number;
      currency: "USD" | "LBP";
      sourceDrawer: string;
    }) => ipcRenderer.invoke("recharge:top-up-app", data),
  },

  // Suppliers
  suppliers: {
    list: (search?: string) => ipcRenderer.invoke("suppliers:list", search),
    getBalances: () => ipcRenderer.invoke("suppliers:balances"),
    getLedger: (supplierId: number, limit?: number) =>
      ipcRenderer.invoke("suppliers:ledger", supplierId, limit),
    create: (data: {
      name: string;
      contact_name?: string;
      phone?: string;
      note?: string;
    }) => ipcRenderer.invoke("suppliers:create", data),
    addLedgerEntry: (data: {
      supplier_id: number;
      entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
      amount_usd: number;
      amount_lbp: number;
      note?: string;
    }) => ipcRenderer.invoke("suppliers:add-ledger-entry", data),
    getUnsettledTransactions: (provider: string) =>
      ipcRenderer.invoke("suppliers:unsettled-transactions", provider),
    getUnsettledSummary: () =>
      ipcRenderer.invoke("suppliers:unsettled-summary"),
    settleTransactions: (data: {
      supplier_id: number;
      financial_service_ids: number[];
      amount_usd: number;
      amount_lbp: number;
      commission_usd: number;
      commission_lbp: number;
      drawer_name: string;
      note?: string;
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
    }) => ipcRenderer.invoke("suppliers:settle-transactions", data),
  },

  // Loto
  loto: {
    sell: (data: {
      ticket_number?: string;
      sale_amount: number;
      commission_rate?: number;
      is_winner?: boolean;
      prize_amount?: number;
      sale_date?: string;
      payment_method?: string;
      currency?: string;
      note?: string;
    }) => ipcRenderer.invoke("loto:sell", data),
    get: (id: number) => ipcRenderer.invoke("loto:get", id),
    getByDateRange: (from: string, to: string) =>
      ipcRenderer.invoke("loto:get-by-date-range", from, to),
    update: (id: number, data: any) =>
      ipcRenderer.invoke("loto:update", id, data),
    report: (from: string, to: string) =>
      ipcRenderer.invoke("loto:report", from, to),
    settlement: (from: string, to: string) =>
      ipcRenderer.invoke("loto:settlement", from, to),
    checkpoint: {
      create: (data: {
        checkpoint_date: string;
        period_start: string;
        period_end: string;
        note?: string;
      }) => ipcRenderer.invoke("loto:checkpoint:create", data),
      get: (id: number) => ipcRenderer.invoke("loto:checkpoint:get", id),
      getByDate: (date: string) =>
        ipcRenderer.invoke("loto:checkpoint:get-by-date", date),
      getByDateRange: (from: string, to: string) =>
        ipcRenderer.invoke("loto:checkpoint:get-by-date-range", from, to),
      getUnsettled: () => ipcRenderer.invoke("loto:checkpoint:get-unsettled"),
      update: (id: number, data: any) =>
        ipcRenderer.invoke("loto:checkpoint:update", id, data),
      markSettled: (id: number, settledAt?: string, settlementId?: number) =>
        ipcRenderer.invoke(
          "loto:checkpoint:mark-settled",
          id,
          settledAt,
          settlementId,
        ),
      settle: (data: {
        id: number;
        totalSales: number;
        totalCommission: number;
        totalPrizes: number;
        settledAt?: string;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
      }) => ipcRenderer.invoke("loto:checkpoint:settle", data),
      getTotalSalesUnsettled: () =>
        ipcRenderer.invoke("loto:checkpoint:get-total-sales-unsettled"),
      getTotalCommissionUnsettled: () =>
        ipcRenderer.invoke("loto:checkpoint:get-total-commission-unsettled"),
      getLast: () => ipcRenderer.invoke("loto:checkpoint:get-last"),
      createScheduled: (checkpointDate?: string) =>
        ipcRenderer.invoke("loto:checkpoint:create-scheduled", checkpointDate),
      delete: (id: number) => ipcRenderer.invoke("loto:checkpoint:delete", id),
    },
    cashPrize: {
      create: (data: {
        ticket_number?: string;
        prize_amount: number;
        customer_name?: string;
        prize_date?: string;
        note?: string;
      }) => ipcRenderer.invoke("loto:cash-prize:create", data),
      getByDateRange: (from: string, to: string) =>
        ipcRenderer.invoke("loto:cash-prize:get-by-date-range", from, to),
      getUnreimbursed: () =>
        ipcRenderer.invoke("loto:cash-prize:get-unreimbursed"),
      markReimbursed: (
        id: number,
        reimbursedDate?: string,
        settlementId?: number,
      ) =>
        ipcRenderer.invoke(
          "loto:cash-prize:mark-reimbursed",
          id,
          reimbursedDate,
          settlementId,
        ),
      getTotalUnreimbursed: () =>
        ipcRenderer.invoke("loto:cash-prize:get-total-unreimbursed"),
    },
    fees: {
      create: (data: {
        fee_amount: number;
        fee_month: string;
        fee_year: number;
        recorded_date?: string;
        note?: string;
      }) => ipcRenderer.invoke("loto:fees:create", data),
      get: (year: number) => ipcRenderer.invoke("loto:fees:get", year),
      pay: (id: number) => ipcRenderer.invoke("loto:fees:pay", id),
    },
    settings: {
      get: () => ipcRenderer.invoke("loto:settings:get"),
      update: (key: string, value: string) =>
        ipcRenderer.invoke("loto:settings:update", key, value),
    },
  },

  // Maintenance
  maintenance: {
    save: (job: unknown) => ipcRenderer.invoke("maintenance:save", job),
    getJobs: (statusFilter?: string) =>
      ipcRenderer.invoke("maintenance:get-jobs", statusFilter),
    delete: (id: number) => ipcRenderer.invoke("maintenance:delete", id),
  },

  // Closing
  closing: {
    getSystemExpectedBalancesDynamic: () =>
      ipcRenderer.invoke("closing:get-system-expected-balances-dynamic"),
    hasOpeningBalanceToday: () =>
      ipcRenderer.invoke("closing:has-opening-balance-today"),
    getCheckpointTimeline: (filters: {
      date?: string;
      type?: "OPENING" | "CLOSING" | "ALL";
      drawer_name?: string;
      user_id?: number;
    }) => ipcRenderer.invoke("closing:getCheckpointTimeline", filters),
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
    recalculateDrawerBalances: () =>
      ipcRenderer.invoke("closing:recalculate-drawer-balances"),
    setOpeningBalances: (data: {
      closing_date: string;
      amounts: Array<{
        drawer_name: string;
        currency_code: string;
        opening_amount: number;
      }>;
    }) => ipcRenderer.invoke("closing:set-opening-balances", data),
  },

  // Settings
  settings: {
    getAll: () => ipcRenderer.invoke("settings:get-all"),
    update: (key: string, value: string) =>
      ipcRenderer.invoke("settings:update", key, value),
  },

  // WhatsApp
  whatsapp: {
    sendTest: (recipientPhone: string, shopName: string) =>
      ipcRenderer.invoke("whatsapp:send-test", { recipientPhone, shopName }),
    sendMessage: (recipientPhone: string, message: string) =>
      ipcRenderer.invoke("whatsapp:send-message", { recipientPhone, message }),
  },

  // Voice Bot
  voicebot: {
    parse: (text: string, currentModule: string) =>
      ipcRenderer.invoke("voicebot:parse", text, currentModule),
    execute: (command: any) => ipcRenderer.invoke("voicebot:execute", command),

    // Qwen-ASR WebSocket methods
    qwenConnect: (windowId: number) =>
      ipcRenderer.invoke("voicebot:qwen:connect", windowId),
    qwenDisconnect: () => ipcRenderer.invoke("voicebot:qwen:disconnect"),
    qwenSendAudio: (audioData: string, format?: string) =>
      ipcRenderer.invoke("voicebot:qwen:send-audio", audioData, format),
    qwenStop: () => ipcRenderer.invoke("voicebot:qwen:stop"),

    // Listen for transcription events
    onTranscription: (cb: (_event: unknown, data: any) => void) => {
      ipcRenderer.on("voicebot:transcription", cb);
      return () => ipcRenderer.removeListener("voicebot:transcription", cb);
    },
    onTranscriptionError: (cb: (_event: unknown, data: any) => void) => {
      ipcRenderer.on("voicebot:transcription-error", cb);
      return () =>
        ipcRenderer.removeListener("voicebot:transcription-error", cb);
    },
  },

  // Diagnostics
  diagnostics: {
    getSyncErrors: () => ipcRenderer.invoke("diagnostics:get-sync-errors"),
    foreignKeyCheck: () => ipcRenderer.invoke("diagnostics:foreign-key-check"),
    getDbPath: () => ipcRenderer.invoke("diagnostics:getDbPath"),
  },

  // Updater
  updater: {
    getStatus: () => ipcRenderer.invoke("updater:get-status"),
    check: () => ipcRenderer.invoke("updater:check"),
    download: () => ipcRenderer.invoke("updater:download"),
    quitAndInstall: () => ipcRenderer.invoke("updater:quit-and-install"),
    // Push events from main process
    onUpdateAvailable: (cb: (_event: unknown, info: any) => void) => {
      ipcRenderer.on("updater:update-available", cb);
      return () => ipcRenderer.removeListener("updater:update-available", cb);
    },
    onDownloadProgress: (cb: (_event: unknown, progress: any) => void) => {
      ipcRenderer.on("updater:download-progress", cb);
      return () => ipcRenderer.removeListener("updater:download-progress", cb);
    },
    onUpdateDownloaded: (cb: (_event: unknown, info: any) => void) => {
      ipcRenderer.on("updater:update-downloaded", cb);
      return () => ipcRenderer.removeListener("updater:update-downloaded", cb);
    },
    onUpdateNotAvailable: (cb: (_event: unknown) => void) => {
      ipcRenderer.on("updater:update-not-available", cb);
      return () =>
        ipcRenderer.removeListener("updater:update-not-available", cb);
    },
    onError: (cb: (_event: unknown, message: string) => void) => {
      ipcRenderer.on("updater:error", cb);
      return () => ipcRenderer.removeListener("updater:error", cb);
    },
  },

  // Reports
  report: {
    generatePDF: (html: string, filename?: string) =>
      ipcRenderer.invoke("report:generate-pdf", { html, filename }),
    backupDatabase: () => ipcRenderer.invoke("report:backup-db"),
    listBackups: () => ipcRenderer.invoke("report:list-backups"),
    verifyBackup: (path: string) =>
      ipcRenderer.invoke("report:verify-backup", { path }),
    restoreDatabase: (path: string) =>
      ipcRenderer.invoke("report:restore-db", { path }),
    getBackupDir: () => ipcRenderer.invoke("backup:getDir"),
    pickBackupDir: () => ipcRenderer.invoke("backup:pickDir"),
    setBackupDir: (dir: string) => ipcRenderer.invoke("backup:setDir", dir),
  },

  // Activity
  activity: {
    getRecent: (limit?: number) =>
      ipcRenderer.invoke("activity:get-recent", limit),
  },

  // Audit Log
  audit: {
    getRecent: (limit?: number) =>
      ipcRenderer.invoke("audit:get-recent", limit),
    search: (filters: Record<string, unknown>) =>
      ipcRenderer.invoke("audit:search", filters),
    getByEntity: (entityType: string, entityId: string) =>
      ipcRenderer.invoke("audit:get-by-entity", entityType, entityId),
  },

  // Transactions (unified)
  transactions: {
    getRecent: (limit?: number, filters?: Record<string, unknown>) =>
      ipcRenderer.invoke("transactions:get-recent", limit, filters),
    getById: (id: number) => ipcRenderer.invoke("transactions:get-by-id", id),
    getByClient: (clientId: number, limit?: number) =>
      ipcRenderer.invoke("transactions:get-by-client", clientId, limit),
    getByDateRange: (from: string, to: string, type?: string) =>
      ipcRenderer.invoke("transactions:get-by-date-range", from, to, type),
    void: (id: number) => ipcRenderer.invoke("transactions:void", id),
    refund: (id: number) => ipcRenderer.invoke("transactions:refund", id),
    dailySummary: (date: string) =>
      ipcRenderer.invoke("transactions:daily-summary", date),
    debtAging: (clientId: number) =>
      ipcRenderer.invoke("transactions:debt-aging", clientId),
    overdueDebts: () => ipcRenderer.invoke("transactions:overdue-debts"),
    revenueByType: (from: string, to: string) =>
      ipcRenderer.invoke("transactions:revenue-by-type", from, to),
    revenueByUser: (from: string, to: string) =>
      ipcRenderer.invoke("transactions:revenue-by-user", from, to),
  },

  // Reporting (aggregated analytics)
  reporting: {
    dailySummaries: (from: string, to: string) =>
      ipcRenderer.invoke("reports:daily-summaries", from, to),
    clientHistory: (clientId: number, limit?: number) =>
      ipcRenderer.invoke("reports:client-history", clientId, limit),
    revenueByModule: (from: string, to: string) =>
      ipcRenderer.invoke("reports:revenue-by-module", from, to),
    overdueDebts: () => ipcRenderer.invoke("reports:overdue-debts"),
  },

  // Profits (admin analytics)
  profits: {
    summary: (from: string, to: string) =>
      ipcRenderer.invoke("profits:summary", from, to),
    byModule: (from: string, to: string) =>
      ipcRenderer.invoke("profits:by-module", from, to),
    byDate: (from: string, to: string) =>
      ipcRenderer.invoke("profits:by-date", from, to),
    byPaymentMethod: (from: string, to: string) =>
      ipcRenderer.invoke("profits:by-payment-method", from, to),
    byUser: (from: string, to: string) =>
      ipcRenderer.invoke("profits:by-user", from, to),
    byClient: (from: string, to: string, limit?: number) =>
      ipcRenderer.invoke("profits:by-client", from, to, limit),
    pending: (from: string, to: string) =>
      ipcRenderer.invoke("profits:pending", from, to),
  },

  // Rates
  rates: {
    list: () => ipcRenderer.invoke("rates:list"),
    set: (data: {
      to_code: string;
      market_rate: number;
      delta: number;
      is_stronger: 1 | -1;
    }) => ipcRenderer.invoke("rates:set", data),
    delete: (to_code: string) => ipcRenderer.invoke("rates:delete", to_code),
  },

  // Currencies
  currencies: {
    list: () => ipcRenderer.invoke("currencies:list"),
    create: (
      code: string,
      name: string,
      symbol?: string,
      decimalPlaces?: number,
    ) =>
      ipcRenderer.invoke("currencies:create", {
        code,
        name,
        symbol,
        decimal_places: decimalPlaces,
      }),
    update: (data: {
      id: number;
      code?: string;
      name?: string;
      symbol?: string;
      decimal_places?: number;
      is_active?: number;
    }) => ipcRenderer.invoke("currencies:update", data),
    delete: (id: number) => ipcRenderer.invoke("currencies:delete", id),
    getModules: (code: string) =>
      ipcRenderer.invoke("currencies:getModules", code),
    byModule: (moduleKey: string) =>
      ipcRenderer.invoke("currencies:byModule", moduleKey),
    setModules: (code: string, modules: string[]) =>
      ipcRenderer.invoke("currencies:setModules", code, modules),
    allDrawerCurrencies: () =>
      ipcRenderer.invoke("currencies:allDrawerCurrencies"),
    forDrawer: (drawerName: string) =>
      ipcRenderer.invoke("currencies:forDrawer", drawerName),
    fullForDrawer: (drawerName: string) =>
      ipcRenderer.invoke("currencies:fullForDrawer", drawerName),
    getDrawers: (code: string) =>
      ipcRenderer.invoke("currencies:getDrawers", code),
    setDrawerCurrencies: (drawerName: string, currencies: string[]) =>
      ipcRenderer.invoke(
        "currencies:setDrawerCurrencies",
        drawerName,
        currencies,
      ),
    configuredDrawers: () => ipcRenderer.invoke("currencies:configuredDrawers"),
  },

  // Modules
  modules: {
    list: () => ipcRenderer.invoke("modules:list"),
    enabled: () => ipcRenderer.invoke("modules:enabled"),
    toggleable: () => ipcRenderer.invoke("modules:toggleable"),
    setEnabled: (key: string, enabled: boolean) =>
      ipcRenderer.invoke("modules:setEnabled", key, enabled),
    bulkSetEnabled: (updates: { key: string; is_enabled: boolean }[]) =>
      ipcRenderer.invoke("modules:bulkSetEnabled", updates),
  },

  // Payment Methods
  paymentMethods: {
    list: () => ipcRenderer.invoke("payment-methods:list"),
    listActive: () => ipcRenderer.invoke("payment-methods:list-active"),
    create: (data: {
      code: string;
      label: string;
      drawer_name: string;
      affects_drawer?: number;
    }) => ipcRenderer.invoke("payment-methods:create", data),
    update: (
      id: number,
      data: {
        label?: string;
        drawer_name?: string;
        affects_drawer?: number;
        is_active?: number;
        sort_order?: number;
      },
    ) => ipcRenderer.invoke("payment-methods:update", id, data),
    delete: (id: number) => ipcRenderer.invoke("payment-methods:delete", id),
    reorder: (ids: number[]) =>
      ipcRenderer.invoke("payment-methods:reorder", ids),
  },

  // Customer Sessions
  session: {
    start: (data: {
      customer_name: string;
      customer_phone?: string;
      customer_notes?: string;
      started_by: string;
    }) => ipcRenderer.invoke("session:start", data),
    getActive: () => ipcRenderer.invoke("session:getActive"),
    get: (sessionId: number) =>
      ipcRenderer.invoke("session:getDetails", sessionId),
    update: (
      sessionId: number,
      data: {
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
      },
    ) => ipcRenderer.invoke("session:update", sessionId, data),
    close: (sessionId: number, closedBy: string) =>
      ipcRenderer.invoke("session:close", sessionId, closedBy),
    list: (limit: number, offset: number) =>
      ipcRenderer.invoke("session:list", limit, offset),
    linkTransaction: (data: {
      transactionType: string;
      transactionId: number;
      amountUsd: number;
      amountLbp: number;
    }) => ipcRenderer.invoke("session:linkTransaction", data),
  },

  // Item Costs
  itemCosts: {
    getAll: () => ipcRenderer.invoke("item-costs:get-all"),
    set: (data: {
      provider: string;
      category: string;
      itemKey: string;
      cost: number;
      currency: string;
    }) => ipcRenderer.invoke("item-costs:set", data),
  },

  // Voucher Images
  voucherImages: {
    getAll: () => ipcRenderer.invoke("voucher-images:get-all"),
    set: (data: {
      provider: string;
      category: string;
      itemKey: string;
      imageData: string;
    }) => ipcRenderer.invoke("voucher-images:set", data),
    delete: (id: number) => ipcRenderer.invoke("voucher-images:delete", id),
  },

  // Mobile Service Items (dynamic catalog)
  mobileServiceItems: {
    getAll: () => ipcRenderer.invoke("mobile-service-items:get-all"),
    getAllAdmin: () => ipcRenderer.invoke("mobile-service-items:get-all-admin"),
    getByProvider: (provider: string) =>
      ipcRenderer.invoke("mobile-service-items:get-by-provider", provider),
    getByProviderCategory: (provider: string, category: string) =>
      ipcRenderer.invoke(
        "mobile-service-items:get-by-provider-category",
        provider,
        category,
      ),
    getCategories: (provider: string) =>
      ipcRenderer.invoke("mobile-service-items:get-categories", provider),
    getSubcategories: (provider: string, category: string) =>
      ipcRenderer.invoke(
        "mobile-service-items:get-subcategories",
        provider,
        category,
      ),
    create: (data: {
      provider: string;
      category: string;
      subcategory: string;
      label: string;
      cost_lbp: number;
      sell_lbp: number;
      sort_order?: number;
      is_active?: number;
    }) => ipcRenderer.invoke("mobile-service-items:create", data),
    update: (
      id: number,
      data: {
        label?: string;
        cost_lbp?: number;
        sell_lbp?: number;
        sort_order?: number;
        is_active?: number;
      },
    ) => ipcRenderer.invoke("mobile-service-items:update", id, data),
    toggleActive: (id: number) =>
      ipcRenderer.invoke("mobile-service-items:toggle-active", id),
    delete: (id: number) =>
      ipcRenderer.invoke("mobile-service-items:delete", id),
    seed: (
      items: {
        provider: string;
        category: string;
        subcategory: string;
        label: string;
        cost_lbp: number;
        sell_lbp: number;
        sort_order?: number;
      }[],
    ) => ipcRenderer.invoke("mobile-service-items:seed", items),
    count: () => ipcRenderer.invoke("mobile-service-items:count"),
  },

  // Custom Services
  customServices: {
    list: (filter?: { date?: string }) =>
      ipcRenderer.invoke("custom-services:list", filter),
    get: (id: number) => ipcRenderer.invoke("custom-services:get", id),
    summary: () => ipcRenderer.invoke("custom-services:summary"),
    add: (data: {
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
    }) => ipcRenderer.invoke("custom-services:add", data),
    delete: (id: number) => ipcRenderer.invoke("custom-services:delete", id),
  },

  // Setup Wizard
  setup: {
    isRequired: () => ipcRenderer.invoke("setup:isRequired"),
    complete: (payload: unknown) =>
      ipcRenderer.invoke("setup:complete", payload),
    reset: () => ipcRenderer.invoke("setup:reset"),
    detectNetworkDb: () => ipcRenderer.invoke("setup:detectNetworkDb"),
    joinExistingShop: (payload: {
      dbPath: string;
      users: Array<{ username: string; password: string; role: string }>;
    }) => ipcRenderer.invoke("setup:joinExistingShop", payload),
    browseForDatabase: () => ipcRenderer.invoke("setup:browseForDatabase"),
    relaunch: () => ipcRenderer.invoke("setup:relaunch"),
  },

  // Display / Zoom
  display: {
    setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
    getZoomFactor: () => webFrame.getZoomFactor(),
    fixFocus: () => ipcRenderer.send("display:fix-focus"),
  },

  // Printing
  print: {
    getPrinters: () => ipcRenderer.invoke("print:get-printers"),
    silentPrint: (html: string, printerName: string, options?: any) =>
      ipcRenderer.invoke("print:silent", html, printerName, options),
  },
});

console.log("[PRELOAD] window.api exposed successfully");

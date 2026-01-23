export interface ElectronAPI {
  // Settings
  settings: {
    getAll: () => Promise<Array<{ key_name: string; value: string }>>;
    update: (key: string, value: string) => Promise<{ success: boolean }>;
  };

  // Expenses
  addExpense: (data: {
    description: string;
    category: string;
    expense_type: string;
    paid_by_method?: "CASH" | "OMT" | "WHISH" | "BINANCE";
    amount_usd: number;
    amount_lbp: number;
    expense_date: string;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  getTodayExpenses: () => Promise<
    Array<{
      id: number;
      description: string;
      category: string;
      expense_type: "Cash_Out" | "Non_Cash";
      paid_by_method?: "CASH" | "OMT" | "WHISH" | "BINANCE";
      amount_usd: number;
      amount_lbp: number;
      expense_date: string;
      created_at?: string;
      updated_at?: string;
    }>
  >;
  deleteExpense: (id: number) => Promise<{ success: boolean; error?: string }>;

  // Auth
  login: (
    username: string,
    password: string,
  ) => Promise<{
    success: boolean;
    user?: { id: number; username: string; role: string };
    sessionToken?: string | null;
    error?: string;
  }>;
  logout: (userId: number) => Promise<{ success: boolean }>;
  restoreSession: () => Promise<{
    success: boolean;
    user?: { id: number; username: string; role: string };
    error?: string;
  }>;
  getCurrentUser: (
    userId: number,
  ) => Promise<{ id: number; username: string; role: string } | null>;
  getNonAdminUsers: () => Promise<
    Array<{ id: number; username: string; role: string; is_active: number }>
  >;
  setUserActive: (
    id: number,
    is_active: number,
  ) => Promise<{ success: boolean; error?: string }>;
  setUserRole: (
    id: number,
    role: "admin" | "staff",
  ) => Promise<{ success: boolean; error?: string }>;
  createUser: (
    username: string,
    password: string,
    role: "admin" | "staff",
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  setUserPassword: (
    id: number,
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Inventory
  getProducts: (
    search?: string,
  ) => Promise<Array<import("@liratek/shared").Product>>;
  getProduct: (id: number) => Promise<import("@liratek/shared").Product | null>;
  getProductByBarcode: (
    barcode: string,
  ) => Promise<import("@liratek/shared").Product | null>;
  createProduct: (
    product: Omit<
      import("@liratek/shared").Product,
      "id" | "created_at" | "is_active"
    > & { is_active?: number },
  ) => Promise<{
    success: boolean;
    id?: number;
    error?: string;
    code?: "DUPLICATE_BARCODE";
    suggested_barcode?: string;
  }>;
  updateProduct: (
    product: Partial<import("@liratek/shared").Product> & { id: number },
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: "DUPLICATE_BARCODE";
    suggested_barcode?: string;
  }>;
  deleteProduct: (id: number) => Promise<{ success: boolean; error?: string }>;
  adjustStock: (
    id: number,
    quantity: number,
  ) => Promise<{ success: boolean; error?: string }>;
  getInventoryStockStats: () => Promise<{
    stock_budget_usd: number;
    stock_count: number;
  }>;
  getLowStockProducts: () => Promise<Array<import("@liratek/shared").Product>>;
  // Clients
  getClients: (
    search?: string,
  ) => Promise<Array<import("@liratek/shared").Client>>;
  getClient: (id: number) => Promise<import("@liratek/shared").Client | null>;
  createClient: (
    client: Omit<import("@liratek/shared").Client, "id" | "created_at">,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  updateClient: (
    client: Partial<import("@liratek/shared").Client> & { id: number },
  ) => Promise<{ success: boolean; error?: string }>;
  deleteClient: (id: number) => Promise<{ success: boolean; error?: string }>;

  // Sales
  processSale: (
    saleData: import("@liratek/shared").SaleRequest,
  ) => Promise<{ success: boolean; saleId?: number; error?: string }>;

  // Recharge
  getRechargeStock: () => Promise<{ mtc: number; alfa: number }>;
  processRecharge: (data: {
    provider: "MTC" | "Alfa";
    type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
    amount: number;
    cost: number;
    price: number;
    paid_by_method?: "CASH" | "OMT" | "WHISH" | "BINANCE";
    phoneNumber?: string;
  }) => Promise<{ success: boolean; saleId?: number; error?: string }>;
  getDashboardStats: () => Promise<{
    totalSalesUSD: number;
    totalSalesLBP: number;
    cashCollectedUSD: number;
    cashCollectedLBP: number;
    ordersCount: number;
    activeClients: number;
    lowStockCount: number;
  }>;
  getProfitSalesChart: (
    type: "Sales" | "Profit",
  ) => Promise<
    Array<{ date: string; usd?: number; lbp?: number; profit?: number }>
  >;
  getTodaysSales: () => Promise<
    Array<{
      id: number;
      client_name: string | null;
      paid_usd: number;
      paid_lbp: number;
      created_at: string;
    }>
  >;
  getDrafts: () => Promise<
    Array<
      import("@liratek/shared").SaleRequest & { id: number; status: "draft" }
    >
  >;
  getTopProducts: () => Promise<
    { name: string; total_quantity: number; total_revenue: number }[]
  >;
  getDrawerBalances: () => Promise<{
    generalDrawer: { usd: number; lbp: number };
    omtDrawer: { usd: number; lbp: number };
  }>; // New

  // Debt
  getDebtSummary: () => Promise<{
    totalDebt: number;
    topDebtors: { full_name: string; total_debt: number }[];
  }>;
  getDebtors: () => Promise<
    {
      id: number;
      full_name: string;
      phone_number: string;
      total_debt: number;
    }[]
  >;
  getClientDebtHistory: (clientId: number) => Promise<
    Array<{
      id: number;
      created_at: string;
      amount_usd: number;
      amount_lbp: number;
      note?: string;
      is_paid: boolean;
    }>
  >;
  addRepayment: (data: {
    clientId: number;
    amountUSD: number;
    amountLBP: number;
    note?: string;
    userId?: number;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  getClientDebtTotal(clientId: number): Promise<number>;

  // Exchange
  currencies: {
    list: () => Promise<
      Array<{ id: number; code: string; name: string; is_active: number }>
    >;
    create: (
      code: string,
      name: string,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (data: {
      id: number;
      code?: string;
      name?: string;
      is_active?: number;
    }) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };
  addExchangeTransaction: (data: {
    fromCurrency: string;
    toCurrency: string;
    amountIn: number;
    amountOut: number;
    rate: number;
    clientName?: string;
    note?: string;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  getExchangeHistory: () => Promise<
    Array<{
      id: number;
      created_at: string;
      from_currency: string;
      to_currency: string;
      rate: number;
      amount_in: number;
      amount_out: number;
    }>
  >;
  rates: {
    list: () => Promise<
      Array<{
        id: number;
        from_code: string;
        to_code: string;
        rate: number;
        updated_at: string;
      }>
    >;
    set: (
      from_code: string,
      to_code: string,
      rate: number,
    ) => Promise<{ success: boolean; error?: string }>;
  };

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
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  getOMTHistory: (provider?: string) => Promise<
    Array<{
      id: number;
      provider: string;
      service_type: string;
      amount_usd: number;
      amount_lbp: number;
      commission_usd: number;
      commission_lbp: number;
      created_at: string;
    }>
  >;
  getOMTAnalytics: () => Promise<{
    today: { commissionUSD: number; commissionLBP: number; count: number };
    month: { commissionUSD: number; commissionLBP: number; count: number };
    byProvider: {
      provider: string;
      commission_usd: number;
      commission_lbp: number;
      count: number;
    }[];
  }>;

  // Recharge
  getRechargeStock: () => Promise<{ mtc: number; alfa: number }>;
  processRecharge: (data: {
    provider: "MTC" | "Alfa";
    type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
    amount: number;
    cost: number;
    price: number;
    phoneNumber?: string;
  }) => Promise<{ success: boolean; saleId?: number; error?: string }>;

  // Suppliers
  listSuppliers: (search?: string) => Promise<
    Array<{
      id: number;
      name: string;
      contact_name: string | null;
      phone: string | null;
      note: string | null;
      is_active: number;
      created_at: string;
    }>
  >;
  getSupplierBalances: () => Promise<
    Array<{ supplier_id: number; total_usd: number; total_lbp: number }>
  >;
  getSupplierLedger: (supplierId: number, limit?: number) => Promise<
    Array<{
      id: number;
      supplier_id: number;
      entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
      amount_usd: number;
      amount_lbp: number;
      note: string | null;
      created_by: number | null;
      created_at: string;
    }>
  >;
  createSupplier: (data: {
    name: string;
    contact_name?: string;
    phone?: string;
    note?: string;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  addSupplierLedgerEntry: (data: {
    supplier_id: number;
    entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
    amount_usd: number;
    amount_lbp: number;
    note?: string;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;

  // Maintenance
  saveMaintenanceJob: (job: {
    id?: number;
    device_name: string;
    issue_description: string;
    cost_usd: number;
    price_usd: number;
    client_id?: number | null;
    client_name?: string;
    client_phone?: string;
    discount_usd?: number;
    final_amount_usd?: number;
    paid_usd?: number;
    paid_lbp?: number;
    exchange_rate?: number;
    status?: "Received" | "In_Progress" | "Ready" | "Delivered";
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  getMaintenanceJobs: (statusFilter?: string) => Promise<
    Array<{
      id: number;
      device_name: string;
      issue_description: string;
      cost_usd: number;
      price_usd: number;
      client_name?: string;
      client_phone?: string;
      status: string;
      created_at: string;
      paid_usd: number;
      paid_lbp: number;
    }>
  >;
  deleteMaintenanceJob: (
    id: number,
  ) => Promise<{ success: boolean; error?: string }>;

  // Activity
  activity: {
    getRecent: (limit?: number) => Promise<
      Array<{
        id: number;
        created_at: string;
        user_id: number | null;
        action: string;
        table_name: string;
        record_id: number | null;
        details_json?: string;
      }>
    >;
  };

  // Diagnostics
  updater: {
    getStatus: () => Promise<{ packaged: boolean; platform: string; version: string }>;
    check: () => Promise<{ success: boolean; updateInfo?: unknown; error?: string }>;
    download: () => Promise<{ success: boolean; result?: unknown; error?: string }>;
    quitAndInstall: () => Promise<{ success: boolean; error?: string }>;
  };

  diagnostics: {
    getSyncErrors: () => Promise<
      Array<{ id: number; endpoint: string; error: string; created_at: string }>
    >;
    foreignKeyCheck: () => Promise<{
      success: boolean;
      rows?: Array<Record<string, unknown>>;
      error?: string;
    }>;
  };

  // Reports
  report: {
    generatePDF: (
      html: string,
      filename?: string,
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    backupDatabase: () => Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }>;
    listBackups: () => Promise<{
      success: boolean;
      backups?: Array<{ path: string; filename: string; createdAtMs: number }>;
      error?: string;
    }>;
    verifyBackup: (path: string) => Promise<{
      success: boolean;
      ok?: boolean;
      error?: string;
    }>;
    restoreDatabase: (path: string) => Promise<{ success: boolean; error?: string }>;
  };

  // Closing
  closing: {
    getSystemExpectedBalances: () => Promise<{
      generalDrawer: { usd: number; lbp: number; eur: number };
      omtDrawer: { usd: number; lbp: number; eur: number };
      whishDrawer: { usd: number; lbp: number; eur: number };
      binanceDrawer: { usd: number; lbp: number; eur: number };
      mtcDrawer: { usd: number; lbp: number; eur: number };
      alfaDrawer: { usd: number; lbp: number; eur: number };
    }>;
    hasOpeningBalanceToday: () => Promise<boolean>;
    setOpeningBalances: (data: {
      closing_date: string;
      amounts: Array<{
        drawer_name: string;
        currency_code: string;
        opening_amount: number;
      }>;
      user_id?: number;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
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
      system_expected_usd?: number;
      system_expected_lbp?: number;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
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
    }) => Promise<{ success: boolean; error?: string }>;
    getDailyStatsSnapshot: () => Promise<{
      salesCount: number;
      totalSalesUSD: number;
      totalSalesLBP: number;
      debtPaymentsUSD: number;
      debtPaymentsLBP: number;
      totalExpensesUSD: number;
      totalExpensesLBP: number;
      totalProfitUSD: number;
    }>;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

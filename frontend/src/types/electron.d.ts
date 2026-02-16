export interface ElectronAPI {
  // Auth & Users
  auth: {
    login: (
      username: string,
      password: string,
      rememberMe?: boolean,
    ) => Promise<{
      success: boolean;
      user?: { id: number; username: string; role: string };
      sessionToken?: string | null;
      error?: string;
    }>;
    logout: (sessionToken: string) => Promise<{ success: boolean }>;
    restoreSession: (sessionToken?: string) => Promise<{
      success: boolean;
      user?: { id: number; username: string; role: string };
      sessionToken?: string;
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
  };

  // Expenses
  expenses: {
    add: (data: {
      description: string;
      category: string;
      paid_by_method?: string;
      amount_usd: number;
      amount_lbp: number;
      expense_date: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getToday: () => Promise<
      Array<{
        id: number;
        description: string;
        category: string;
        paid_by_method?: string;
        amount_usd: number;
        amount_lbp: number;
        expense_date: string;
        created_at?: string;
        updated_at?: string;
      }>
    >;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  // Inventory
  inventory: {
    getProducts: (
      search?: string,
    ) => Promise<Array<import("@liratek/core").Product>>;
    getProduct: (id: number) => Promise<import("@liratek/core").Product | null>;
    getProductByBarcode: (
      barcode: string,
    ) => Promise<import("@liratek/core").Product | null>;
    createProduct: (
      product: Omit<
        import("@liratek/core").Product,
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
      product: Partial<import("@liratek/core").Product> & { id: number },
    ) => Promise<{
      success: boolean;
      error?: string;
      code?: "DUPLICATE_BARCODE";
      suggested_barcode?: string;
    }>;
    deleteProduct: (
      id: number,
    ) => Promise<{ success: boolean; error?: string }>;
    adjustStock: (
      id: number,
      quantity: number,
    ) => Promise<{ success: boolean; error?: string }>;
    getStockStats: () => Promise<{
      stock_budget_usd: number;
      stock_count: number;
    }>;
    getLowStockProducts: () => Promise<Array<import("@liratek/core").Product>>;
  };

  // Clients
  clients: {
    getAll: (search?: string) => Promise<Array<import("@liratek/core").Client>>;
    get: (id: number) => Promise<import("@liratek/core").Client | null>;
    create: (
      client: Omit<import("@liratek/core").Client, "id" | "created_at">,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (
      client: Partial<import("@liratek/core").Client> & { id: number },
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  // Sales
  sales: {
    process: (
      saleData: import("@liratek/core").SaleRequest,
    ) => Promise<{ success: boolean; saleId?: number; error?: string }>;
    get: (saleId: number) => Promise<any>;
    getItems: (saleId: number) => Promise<any[]>;
    getDrafts: () => Promise<
      Array<
        import("@liratek/core").SaleRequest & { id: number; status: "draft" }
      >
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
    getTopProducts: () => Promise<
      { name: string; total_quantity: number; total_revenue: number }[]
    >;
  };

  // Dashboard
  dashboard: {
    getStats: () => Promise<{
      totalSalesUSD: number;
      totalSalesLBP: number;
      cashCollectedUSD: number;
      cashCollectedLBP: number;
      ordersCount: number;
      activeClients: number;
      lowStockCount: number;
    }>;
    getDrawerBalances: () => Promise<{
      generalDrawer: { usd: number; lbp: number };
      omtDrawer: { usd: number; lbp: number };
    }>;
    getProfitSalesChart: (
      type: "Sales" | "Profit",
    ) => Promise<
      Array<{ date: string; usd?: number; lbp?: number; profit?: number }>
    >;
  };

  // Debt
  debt: {
    getSummary: () => Promise<{
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
    getClientHistory: (clientId: number) => Promise<
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
      paidByMethod?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getClientTotal: (clientId: number) => Promise<number>;
  };

  // Financial
  financial: {
    getMonthlyPL: (month: string) => Promise<{
      month: string;
      salesProfitUSD: number;
      serviceCommissionsUSD: number;
      serviceCommissionsLBP: number;
      expensesUSD: number;
      expensesLBP: number;
      netProfitUSD: number;
    }>;
    getDrawerNames: () => Promise<string[]>;
  };

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
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getHistory: () => Promise<
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
  };

  // Binance
  binance: {
    addTransaction: (data: {
      type: "SEND" | "RECEIVE";
      amount: number;
      currencyCode?: string;
      description?: string;
      clientName?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getHistory: (limit?: number) => Promise<
      Array<{
        id: number;
        created_at: string;
        type: string;
        amount: number;
        currency_code?: string;
        description?: string;
        client_name?: string;
      }>
    >;
    getTodayStats: () => Promise<{
      totalSent: number;
      totalReceived: number;
      count: number;
    }>;
  };

  // OMT/Whish Financial Services
  omt: {
    addTransaction: (data: {
      provider:
        | "OMT"
        | "WHISH"
        | "BOB"
        | "OTHER"
        | "IPEC"
        | "KATCH"
        | "WISH_APP"
        | "OMT_APP";
      serviceType: "SEND" | "RECEIVE" | "BILL_PAYMENT";
      amountUSD: number;
      amountLBP: number;
      commissionUSD: number;
      commissionLBP: number;
      clientName?: string;
      referenceNumber?: string;
      note?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getHistory: (provider?: string) => Promise<
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
    getAnalytics: () => Promise<{
      today: { commissionUSD: number; commissionLBP: number; count: number };
      month: { commissionUSD: number; commissionLBP: number; count: number };
      byProvider: {
        provider: string;
        commission_usd: number;
        commission_lbp: number;
        count: number;
      }[];
    }>;
  };

  // Recharge
  recharge: {
    getStock: () => Promise<{ mtc: number; alfa: number }>;
    process: (data: {
      provider: "MTC" | "Alfa";
      type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
      amount: number;
      cost: number;
      price: number;
      paid_by_method?: string;
      phoneNumber?: string;
    }) => Promise<{ success: boolean; saleId?: number; error?: string }>;
    topUp: (data: {
      provider: "MTC" | "Alfa";
      amount: number;
      currency?: string;
    }) => Promise<{ success: boolean; error?: string }>;
  };

  // Suppliers
  suppliers: {
    list: (search?: string) => Promise<
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
    getBalances: () => Promise<
      Array<{ supplier_id: number; total_usd: number; total_lbp: number }>
    >;
    getLedger: (
      supplierId: number,
      limit?: number,
    ) => Promise<
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
    create: (data: {
      name: string;
      contact_name?: string;
      phone?: string;
      note?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    addLedgerEntry: (data: {
      supplier_id: number;
      entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
      amount_usd: number;
      amount_lbp: number;
      note?: string;
      drawer_name?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
  };

  // Maintenance
  maintenance: {
    save: (job: {
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
    getJobs: (statusFilter?: string) => Promise<
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
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  // Settings
  settings: {
    getAll: () => Promise<Array<{ key_name: string; value: string }>>;
    update: (key: string, value: string) => Promise<{ success: boolean }>;
  };

  // Closing
  closing: {
    getSystemExpectedBalancesDynamic: () => Promise<
      Record<string, Record<string, number>>
    >;
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

  // Diagnostics
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

  // Updater
  updater: {
    getStatus: () => Promise<{
      packaged: boolean;
      platform: string;
      version: string;
    }>;
    check: () => Promise<{
      success: boolean;
      updateInfo?: unknown;
      error?: string;
    }>;
    download: () => Promise<{
      success: boolean;
      result?: unknown;
      error?: string;
    }>;
    quitAndInstall: () => Promise<{ success: boolean; error?: string }>;
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
    restoreDatabase: (
      path: string,
    ) => Promise<{ success: boolean; error?: string }>;
  };

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

  // Rates
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

  // Currencies
  currencies: {
    list: () => Promise<
      Array<{
        id: number;
        code: string;
        name: string;
        symbol: string;
        decimal_places: number;
        is_active: number;
      }>
    >;
    create: (
      code: string,
      name: string,
      symbol?: string,
      decimalPlaces?: number,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (data: {
      id: number;
      code?: string;
      name?: string;
      symbol?: string;
      decimal_places?: number;
      is_active?: number;
    }) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    getModules: (code: string) => Promise<string[]>;
    byModule: (moduleKey: string) => Promise<
      Array<{
        id: number;
        code: string;
        name: string;
        symbol: string;
        decimal_places: number;
        is_active: number;
      }>
    >;
    setModules: (
      code: string,
      modules: string[],
    ) => Promise<{ success: boolean; error?: string }>;
    allDrawerCurrencies: () => Promise<Record<string, string[]>>;
    forDrawer: (drawerName: string) => Promise<string[]>;
    getDrawers: (code: string) => Promise<string[]>;
    setDrawerCurrencies: (
      drawerName: string,
      currencies: string[],
    ) => Promise<{ success: boolean; error?: string }>;
    configuredDrawers: () => Promise<string[]>;
  };

  // Modules
  modules: {
    list: () => Promise<
      Array<{
        key: string;
        label: string;
        icon: string;
        route: string;
        sort_order: number;
        is_enabled: number;
        admin_only: number;
        is_system: number;
      }>
    >;
    enabled: () => Promise<
      Array<{
        key: string;
        label: string;
        icon: string;
        route: string;
        sort_order: number;
        is_enabled: number;
        admin_only: number;
        is_system: number;
      }>
    >;
    toggleable: () => Promise<
      Array<{
        key: string;
        label: string;
        icon: string;
        route: string;
        sort_order: number;
        is_enabled: number;
        admin_only: number;
        is_system: number;
      }>
    >;
    setEnabled: (
      key: string,
      enabled: boolean,
    ) => Promise<{ success: boolean; error?: string }>;
    bulkSetEnabled: (
      updates: { key: string; is_enabled: boolean }[],
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // Payment Methods
  paymentMethods: {
    list: () => Promise<
      Array<{
        id: number;
        code: string;
        label: string;
        drawer_name: string;
        affects_drawer: number;
        sort_order: number;
        is_active: number;
        is_system: number;
        created_at: string;
      }>
    >;
    listActive: () => Promise<
      Array<{
        id: number;
        code: string;
        label: string;
        drawer_name: string;
        affects_drawer: number;
        sort_order: number;
        is_active: number;
        is_system: number;
        created_at: string;
      }>
    >;
    create: (data: {
      code: string;
      label: string;
      drawer_name: string;
      affects_drawer?: number;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (
      id: number,
      data: {
        label?: string;
        drawer_name?: string;
        affects_drawer?: number;
        is_active?: number;
        sort_order?: number;
      },
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    reorder: (ids: number[]) => Promise<{ success: boolean; error?: string }>;
  };

  // Customer Sessions
  session: {
    start: (data: {
      customer_name: string;
      customer_phone?: string;
      customer_notes?: string;
      started_by: string;
    }) => Promise<{ success: boolean; sessionId?: number; error?: string }>;
    getActive: () => Promise<{
      success: boolean;
      session?: {
        id: number;
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
        started_at: string;
        closed_at?: string;
        started_by: string;
        closed_by?: string;
        is_active: 1 | 0;
      };
      error?: string;
    }>;
    get: (sessionId: number) => Promise<{
      success: boolean;
      session?: any;
      transactions?: any[];
      error?: string;
    }>;
    update: (
      sessionId: number,
      data: {
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
      },
    ) => Promise<{ success: boolean; error?: string }>;
    close: (
      sessionId: number,
      closedBy: string,
    ) => Promise<{ success: boolean; error?: string }>;
    list: (
      limit: number,
      offset: number,
    ) => Promise<{
      success: boolean;
      sessions?: any[];
      error?: string;
    }>;
    linkTransaction: (data: {
      transactionType: string;
      transactionId: number;
      amountUsd: number;
      amountLbp: number;
    }) => Promise<{ success: boolean; linked: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

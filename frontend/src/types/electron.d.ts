/** A mobile service catalog item stored in the database */
export interface MobileServiceItem {
  id: number;
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** An audit log entry */
export interface AuditLogEntry {
  id: number;
  user_id: number;
  username: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  old_values: string | null;
  new_values: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

/** Filters for searching audit logs */
export interface AuditSearchFilters {
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

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
    batchUpdate: (payload: {
      ids: number[];
      category?: string;
      min_stock_level?: number;
      supplier_id?: number | null;
      unit?: string | null;
    }) => Promise<{ success: boolean; updated: number; error?: string }>;
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
    batchDelete: (
      ids: number[],
    ) => Promise<{ success: boolean; deleted?: number; error?: string }>;
    adjustStock: (
      id: number,
      quantity: number,
    ) => Promise<{ success: boolean; error?: string }>;
    getStockStats: () => Promise<{
      stock_budget_usd: number;
      stock_count: number;
    }>;
    getLowStockProducts: () => Promise<Array<import("@liratek/core").Product>>;
    getCategories: () => Promise<string[]>;
    getCategoriesFull: () => Promise<
      Array<{ id: number; name: string; sort_order: number; is_active: number }>
    >;
    createCategory: (
      name: string,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    updateCategory: (
      id: number,
      name: string,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteCategory: (
      id: number,
    ) => Promise<{ success: boolean; error?: string }>;
    getProductSuppliers: () => Promise<string[]>;
    getProductSuppliersFull: () => Promise<
      Array<{
        id: number;
        name: string;
        sort_order: number;
        is_active: number;
        product_count: number;
      }>
    >;
    createProductSupplier: (
      name: string,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    updateProductSupplier: (
      id: number,
      name: string,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteProductSupplier: (
      id: number,
    ) => Promise<{ success: boolean; error?: string }>;
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
    importDebts: (
      data: Array<{
        name: string;
        phone: string;
        entries: Array<{
          date: string | null;
          amount_usd: number;
          amount_lbp: number;
          description: string;
          type: "debt" | "payment";
        }>;
      }>,
    ) => Promise<{
      success: boolean;
      error?: string;
      result?: {
        clientsCreated: number;
        clientsSkipped: number;
        clientsDiscarded: number;
        entriesImported: number;
        errors: string[];
      };
    }>;
  };

  // Sales
  sales: {
    process: (
      saleData: import("@liratek/core").SaleRequest,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    get: (saleId: number) => Promise<any>;
    getItems: (saleId: number) => Promise<any[]>;
    getDrafts: () => Promise<
      Array<
        import("@liratek/core").SaleRequest & { id: number; status: "draft" }
      >
    >;
    deleteDraft: (
      saleId: number,
    ) => Promise<{ success: boolean; error?: string }>;
    getTodaysSales: (date?: string) => Promise<
      Array<{
        id: number;
        client_name: string | null;
        paid_usd: number;
        paid_lbp: number;
        final_amount_usd: number;
        discount_usd: number;
        status: string;
        item_count: number;
        created_at: string;
      }>
    >;
    getTopProducts: () => Promise<
      { name: string; total_quantity: number; total_revenue: number }[]
    >;
    refund: (saleId: number) => Promise<{
      success: boolean;
      refundId?: number;
      error?: string;
    }>;
    refundItem: (
      saleId: number,
      saleItemId: number,
      refundQuantity: number,
    ) => Promise<{
      success: boolean;
      refundId?: number;
      error?: string;
    }>;
    getByDateRange: (
      startDate: string,
      endDate: string,
    ) => Promise<
      Array<{
        id: number;
        client_id: number | null;
        client_name: string | null;
        client_phone: string | null;
        total_amount_usd: number;
        discount_usd: number;
        final_amount_usd: number;
        paid_usd: number;
        paid_lbp: number;
        change_given_usd: number;
        change_given_lbp: number;
        exchange_rate_snapshot: number;
        drawer_name: string;
        status: string;
        note: string | null;
        created_at: string;
        item_count: number;
      }>
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
      /** Accumulated drawer balances (not filtered by date) */
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
        total_debt_usd: number;
        total_debt_lbp: number;
      }[]
    >;
    getClientHistory: (clientId: number) => Promise<
      Array<{
        id: number;
        client_id: number;
        transaction_id: number | null;
        transaction_type: string;
        amount_usd: number;
        amount_lbp: number;
        note: string | null;
        created_at: string;
        created_by: number | null;
      }>
    >;
    addRepayment: (data: {
      clientId: number;
      amountUSD: number;
      amountLBP: number;
      note?: string;
      userId?: number;
      paidByMethod?: string;
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
      }>;
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
      netProfitLBP: number;
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
    getById: (id: number) => Promise<Record<string, unknown> | null>;
    getPaymentsByTransaction: (transactionId: number) => Promise<
      Array<{
        id: number;
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
        note: string | null;
        created_at: string;
      }>
    >;
  };

  // Recharge
  recharge: {
    getStock: () => Promise<{ mtc: number; alfa: number }>;
    getHistory: (provider: "MTC" | "Alfa") => Promise<
      Array<{
        id: number;
        carrier: string;
        recharge_type: string;
        amount: number;
        cost: number;
        price: number;
        currency_code: string;
        paid_by: string;
        phone_number: string | null;
        client_id: number | null;
        client_name: string | null;
        note: string | null;
        created_at: string;
        created_by: number;
      }>
    >;
    process: (data: {
      provider: "MTC" | "Alfa";
      type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
      amount: number;
      cost: number;
      price: number;
      paid_by_method?: string;
      phoneNumber?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    topUp: (data: {
      provider: "MTC" | "Alfa";
      amount: number;
      currency?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    topUpApp: (data: {
      provider: "MTC" | "Alfa" | "OMT_APP" | "WHISH_APP" | "iPick" | "Katsh";
      amount: number;
      currency: "USD" | "LBP";
      sourceDrawer: string;
    }) => Promise<{ success: boolean; error?: string }>;
    getDrawerBalances: () => Promise<
      Array<{
        name: string;
        usdBalance: number;
        lbpBalance: number;
      }>
    >;
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
    getUnsettledTransactions: (provider: string) => Promise<
      Array<{
        id: number;
        service_type: string;
        amount: number;
        currency: string;
        commission: number;
        omt_fee: number | null;
        omt_service_type: string | null;
        client_name: string | null;
        created_at: string;
      }>
    >;
    getUnsettledSummary: () => Promise<
      Array<{
        provider: string;
        count: number;
        pending_commission_usd: number;
        pending_commission_lbp: number;
        total_owed_usd: number;
        total_owed_lbp: number;
      }>
    >;
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
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
  };

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
    }) => Promise<{ success: boolean; ticket?: any; error?: string }>;
    get: (
      id: number,
    ) => Promise<{ success: boolean; ticket?: any; error?: string }>;
    getByDateRange: (
      from: string,
      to: string,
    ) => Promise<{
      success: boolean;
      tickets?: any[];
      error?: string;
    }>;
    getUncheckpointed: () => Promise<{
      success: boolean;
      tickets?: any[];
      error?: string;
    }>;
    update: (
      id: number,
      data: any,
    ) => Promise<{
      success: boolean;
      ticket?: any;
      error?: string;
    }>;
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
    checkpoint: {
      create: (data: {
        checkpoint_date: string;
        period_start: string;
        period_end: string;
        note?: string;
      }) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
      get: (
        id: number,
      ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
      getByDate: (
        date: string,
      ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
      getByDateRange: (
        from: string,
        to: string,
      ) => Promise<{
        success: boolean;
        checkpoints?: any[];
        error?: string;
      }>;
      getUnsettled: () => Promise<{
        success: boolean;
        checkpoints?: any[];
        error?: string;
      }>;
      update: (
        id: number,
        data: any,
      ) => Promise<{
        success: boolean;
        checkpoint?: any;
        error?: string;
      }>;
      markSettled: (
        id: number,
        settledAt?: string,
        settlementId?: number,
      ) => Promise<{
        success: boolean;
        checkpoint?: any;
        error?: string;
      }>;
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
      }) => Promise<{
        success: boolean;
        checkpoint?: any;
        error?: string;
      }>;
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
    cashPrize: {
      create: (data: {
        ticket_number?: string;
        prize_amount: number;
        customer_name?: string;
        prize_date?: string;
        note?: string;
      }) => Promise<{ success: boolean; prize?: any; error?: string }>;
      getByDateRange: (
        from: string,
        to: string,
      ) => Promise<{
        success: boolean;
        prizes?: any[];
        error?: string;
      }>;
      getUnreimbursed: () => Promise<{
        success: boolean;
        prizes?: any[];
        error?: string;
      }>;
      markReimbursed: (
        id: number,
        reimbursedDate?: string,
        settlementId?: number,
      ) => Promise<{
        success: boolean;
        prize?: any;
        error?: string;
      }>;
      getTotalUnreimbursed: () => Promise<{
        success: boolean;
        total?: number;
        error?: string;
      }>;
    };
    fees: {
      create: (data: {
        fee_amount: number;
        fee_month: string;
        fee_year: number;
        recorded_date?: string;
        note?: string;
      }) => Promise<{ success: boolean; fee?: any; error?: string }>;
      get: (
        year: number,
      ) => Promise<{ success: boolean; fees?: any[]; error?: string }>;
      pay: (
        id: number,
      ) => Promise<{ success: boolean; fee?: any; error?: string }>;
    };
    settings: {
      get: () => Promise<{
        success: boolean;
        settings?: Record<string, string>;
        error?: string;
      }>;
      update: (
        key: string,
        value: string,
      ) => Promise<{
        success: boolean;
        setting?: any;
        error?: string;
      }>;
    };
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

  // WhatsApp
  whatsapp: {
    sendTest: (
      recipientPhone: string,
      shopName: string,
    ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
    sendMessage: (
      recipientPhone: string,
      message: string,
    ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  };

  // Voice Bot
  voicebot: {
    parse: (
      text: string,
      currentModule: string,
    ) => Promise<{
      success: boolean;
      command?: {
        module: string;
        action: string;
        entities: {
          amount?: number;
          phone?: string;
          name?: string;
          product?: string;
          quantity?: number;
          serviceType?: "SEND" | "RECEIVE";
        };
      };
      error?: string;
    }>;
    execute: (command: {
      module: string;
      action: string;
      entities: {
        amount?: number;
        phone?: string;
        name?: string;
        product?: string;
        quantity?: number;
        serviceType?: "SEND" | "RECEIVE";
      };
    }) => Promise<{
      success: boolean;
      message?: string;
      entities?: any;
      error?: string;
      route?: string;
    }>;
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
    recalculateDrawerBalances: () => Promise<{
      success: boolean;
      error?: string;
    }>;
    getCheckpointTimeline: (filters: {
      date?: string;
      type?: "OPENING" | "CLOSING" | "ALL";
      drawer_name?: string;
      user_id?: number;
    }) => Promise<{
      success: boolean;
      checkpoints?: Array<{
        id: number;
        closing_date: string;
        drawer_name: string;
        checkpoint_type: "OPENING" | "CLOSING";
        created_at: string;
        created_by: number;
        user_name: string;
        notes?: string;
        currencies: Array<{
          currency_code: string;
          opening_amount: number;
          physical_amount?: number;
          variance?: number;
        }>;
      }>;
      error?: string;
    }>;
  };

  // Session
  session: {
    start: (data: {
      customer_name?: string;
      customer_phone?: string;
      customer_notes?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    close: (sessionId: number) => Promise<{ success: boolean; error?: string }>;
    update: (
      sessionId: number,
      data: {
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
      },
    ) => Promise<{ success: boolean; error?: string }>;
    list: () => Promise<{ success: boolean; sessions?: any[]; error?: string }>;
    linkTransaction: (data: {
      sessionId?: number;
      transactionType: string;
      transactionId: number;
      amountUsd: number;
      amountLbp: number;
    }) => Promise<{ success: boolean; linked: boolean; error?: string }>;
    getTransactions: (sessionId: number) => Promise<{
      success: boolean;
      transactions?: any[];
      error?: string;
    }>;
    getByCustomer: (data: {
      customerName: string;
      customerPhone?: string | undefined;
    }) => Promise<{ success: boolean; sessions?: any[]; error?: string }>;
  };

  // Currencies
  currencies: {
    list: () => Promise<
      Array<{ code: string; name: string; is_active: number }>
    >;
    get: (
      code: string,
    ) => Promise<{ code: string; name: string; is_active: number } | null>;
    allDrawerCurrencies: () => Promise<Record<string, string[]>>;
  };

  // Transactions
  transactions: {
    list: (filter?: { date?: string; type?: string }) => Promise<any[]>;
    get: (id: number) => Promise<any | null>;
    getById: (id: number) => Promise<any | null>;
  };

  // Profits
  profits: {
    summary: (
      startDate: string,
      endDate: string,
    ) => Promise<{
      totalRevenueUsd: number;
      totalRevenueLbp: number;
      totalCostUsd: number;
      totalCostLbp: number;
      totalProfitUsd: number;
      totalProfitLbp: number;
    }>;
    byModule: (startDate: string, endDate: string) => Promise<any[]>;
    byDate: (startDate: string, endDate: string) => Promise<any[]>;
    byPaymentMethod: (startDate: string, endDate: string) => Promise<any[]>;
    byUser: (startDate: string, endDate: string) => Promise<any[]>;
    byClient: (
      startDate: string,
      endDate: string,
      clientId?: number,
    ) => Promise<any[]>;
    pending: (startDate: string, endDate: string) => Promise<any[]>;
  };

  // Diagnostics
  diagnostics: {
    getSyncErrors: () => Promise<any[]>;
    foreignKeyCheck: () => Promise<{
      success: boolean;
      rows?: any[];
      error?: string;
    }>;
    getDbPath: () => Promise<{
      success: boolean;
      path?: string;
      source?: string;
      error?: string;
    }>;
  };

  // Report
  report: {
    generateDaily: (
      date: string,
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    generateWeekly: (
      startDate: string,
      endDate: string,
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    generateMonthly: (
      year: number,
      month: number,
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    listBackups: () => Promise<{
      success: boolean;
      backups?: any[];
      error?: string;
    }>;
    backupDatabase: () => Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }>;
    verifyBackup: (
      backupPath: string,
    ) => Promise<{ ok: boolean; success?: boolean; error?: string }>;
    restoreDatabase: (
      backupPath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    deleteBackup: (
      backupPath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    getBackupDir: () => Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }>;
    pickBackupDir: () => Promise<{
      success: boolean;
      path?: string;
      canceled?: boolean;
      error?: string;
    }>;
    setBackupDir: (dir: string) => Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }>;
  };

  // Updater
  updater: {
    getStatus: () => Promise<{
      packaged: boolean;
      platform: string;
      version: string;
      updateAvailable?: boolean;
      downloadProgress?: number;
      devMode?: boolean;
      updateInfo?: {
        version: string;
        releaseDate: string;
        releaseNotes: string;
      };
    }>;
    check: () => Promise<{
      success: boolean;
      updateAvailable?: boolean;
      devMode?: boolean;
      updateInfo?: {
        version: string;
        releaseDate: string;
        releaseNotes: string;
      };
      error?: string;
    }>;
    download: () => Promise<{ success: boolean; error?: string }>;
    quitAndInstall: () => void;
    onUpdateAvailable: (cb: (_event: any, info: any) => void) => () => void;
    onUpdateNotAvailable: (cb: (_event: any) => void) => () => void;
    onDownloadProgress: (
      cb: (_event: any, progress: any) => void,
    ) => () => void;
    onUpdateDownloaded: (cb: (info: any) => void) => () => void;
    onError: (cb: (error: any) => void) => () => void;
  };

  // Setup Wizard
  setup: {
    isRequired: () => Promise<{
      success: boolean;
      isRequired: boolean;
      error?: string;
    }>;
    complete: (payload: {
      shop_name: string;
      admin_username: string;
      admin_password: string;
      enabled_modules: string[];
      enabled_payment_methods: string[];
      session_management_enabled: boolean;
      customer_sessions_enabled: boolean;
      active_currencies?: string[];
      extra_users?: { username: string; password: string; role: string }[];
      whatsapp_phone?: string;
      whatsapp_api_key?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    reset: () => Promise<{ success: boolean; error?: string }>;
    detectNetworkDb: () => Promise<{
      success: boolean;
      databases: Array<{ path: string; shopName: string }>;
      error?: string;
    }>;
    joinExistingShop: (payload: {
      dbPath: string;
      users: Array<{ username: string; password: string; role: string }>;
    }) => Promise<{
      success: boolean;
      requiresRestart?: boolean;
      shopName?: string;
      error?: string;
    }>;
    browseForDatabase: () => Promise<{
      success: boolean;
      path?: string;
      shopName?: string;
      canceled?: boolean;
      error?: string;
    }>;
    relaunch: () => Promise<void>;
  };

  // Mobile Service Items (dynamic catalog)
  mobileServiceItems: {
    getAll: () => Promise<{
      success: boolean;
      data?: MobileServiceItem[];
      error?: string;
    }>;
    getAllAdmin: () => Promise<{
      success: boolean;
      data?: MobileServiceItem[];
      error?: string;
    }>;
    getByProvider: (provider: string) => Promise<{
      success: boolean;
      data?: MobileServiceItem[];
      error?: string;
    }>;
    getByProviderCategory: (
      provider: string,
      category: string,
    ) => Promise<{
      success: boolean;
      data?: MobileServiceItem[];
      error?: string;
    }>;
    getCategories: (provider: string) => Promise<{
      success: boolean;
      data?: string[];
      error?: string;
    }>;
    getSubcategories: (
      provider: string,
      category: string,
    ) => Promise<{
      success: boolean;
      data?: string[];
      error?: string;
    }>;
    create: (data: {
      provider: string;
      category: string;
      subcategory: string;
      label: string;
      cost_lbp: number;
      sell_lbp: number;
      sort_order?: number;
      is_active?: number;
    }) => Promise<{
      success: boolean;
      data?: MobileServiceItem;
      error?: string;
    }>;
    update: (
      id: number,
      data: {
        label?: string;
        cost_lbp?: number;
        sell_lbp?: number;
        sort_order?: number;
        is_active?: number;
      },
    ) => Promise<{
      success: boolean;
      data?: MobileServiceItem;
      error?: string;
    }>;
    toggleActive: (id: number) => Promise<{
      success: boolean;
      data?: MobileServiceItem;
      error?: string;
    }>;
    delete: (id: number) => Promise<{
      success: boolean;
      error?: string;
    }>;
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
    ) => Promise<{
      success: boolean;
      count?: number;
      error?: string;
    }>;
    count: () => Promise<{
      success: boolean;
      data?: number;
      error?: string;
    }>;
  };

  // Display / Zoom
  display: {
    setZoomFactor: (factor: number) => void;
    getZoomFactor: () => number;
    fixFocus: () => void;
  };

  print: {
    getPrinters: () => Promise<
      { name: string; displayName: string; description: string }[]
    >;
    silentPrint: (
      html: string,
      printerName: string,
      options?: any,
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // Custom Services
  customServices: {
    list: (filter?: { date?: string }) => Promise<
      Array<{
        id: number;
        description: string;
        cost_usd: number;
        cost_lbp: number;
        price_usd: number;
        price_lbp: number;
        profit_usd: number;
        profit_lbp: number;
        paid_by: string;
        status: string;
        client_id: number | null;
        client_name: string | null;
        phone_number: string | null;
        note: string | null;
        created_by: number | null;
        created_at: string;
      }>
    >;
    get: (id: number) => Promise<{
      id: number;
      description: string;
      cost_usd: number;
      cost_lbp: number;
      price_usd: number;
      price_lbp: number;
      profit_usd: number;
      profit_lbp: number;
      paid_by: string;
      status: string;
      client_id: number | null;
      client_name: string | null;
      phone_number: string | null;
      note: string | null;
      created_by: number | null;
      created_at: string;
    } | null>;
    summary: () => Promise<{
      count: number;
      totalCostUsd: number;
      totalCostLbp: number;
      totalPriceUsd: number;
      totalPriceLbp: number;
      totalProfitUsd: number;
      totalProfitLbp: number;
    }>;
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
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  // Audit Log
  audit: {
    getRecent: (limit?: number) => Promise<{
      success: boolean;
      rows?: AuditLogEntry[];
      error?: string;
    }>;
    search: (filters: AuditSearchFilters) => Promise<{
      success: boolean;
      rows?: AuditLogEntry[];
      total?: number;
      error?: string;
    }>;
    getByEntity: (
      entityType: string,
      entityId: string,
    ) => Promise<{
      success: boolean;
      rows?: AuditLogEntry[];
      error?: string;
    }>;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

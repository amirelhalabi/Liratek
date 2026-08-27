import { contextBridge, ipcRenderer, webFrame } from "electron";
// Type-only: erased at compile time, so the preload bundle gains no runtime
// dependency on @liratek/core (which is main-process only). preload.ts is
// compiled to CommonJS (tsconfig.preload.json, module: Node16) while core is
// ESM, hence the explicit resolution-mode attribute — without it TS1541.
import type { ProductListFilters } from "@liratek/core" with {
  "resolution-mode": "import",
};

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
    onSessionExpired: (callback: () => void) => {
      const cb = () => callback();
      ipcRenderer.on("session:expired", cb);
      return () => ipcRenderer.removeListener("session:expired", cb);
    },
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
    updateMetadata: (data: {
      id: number;
      description?: string;
      category?: string;
      note?: string;
    }) => ipcRenderer.invoke("expenses:update-metadata", data),
  },

  // Inventory
  inventory: {
    getProducts: (search?: string, filters?: ProductListFilters) =>
      ipcRenderer.invoke("inventory:get-products", search, filters),
    getProductFilterOptions: () =>
      ipcRenderer.invoke("inventory:get-product-filter-options"),
    getProduct: (id: number) => ipcRenderer.invoke("inventory:get-product", id),
    getProductByBarcode: (barcode: string) =>
      ipcRenderer.invoke("inventory:get-product-by-barcode", barcode),
    /** LIRA-143 Phase 3 (owner decision #2): barcode first, then an active
     *  (IN_STOCK) unit IMEI — resolves the owning product and, on an IMEI
     *  hit, the specific matched unit. */
    resolveScanCode: (code: string) =>
      ipcRenderer.invoke("inventory:resolve-scan-code", { code }),
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
    adjustStock: (payload: {
      id: number;
      newQuantity?: number;
      delta?: number;
      reason: string;
    }) => ipcRenderer.invoke("inventory:adjust-stock", payload),
    getStockAdjustments: (productId?: number) =>
      ipcRenderer.invoke("inventory:get-stock-adjustments", productId),
    getLowStockProducts: () =>
      ipcRenderer.invoke("inventory:get-low-stock-products"),
    getNegativeStock: () => ipcRenderer.invoke("inventory:get-negative-stock"),
    getStockStats: () => ipcRenderer.invoke("inventory:get-stock-stats"),
    getCategories: () => ipcRenderer.invoke("inventory:get-categories"),
    getCategoriesFull: () =>
      ipcRenderer.invoke("inventory:get-categories-full"),
    createCategory: (name: string) =>
      ipcRenderer.invoke("inventory:create-category", name),
    /** LIRA-143 Phase 5 (decision #9): `data` accepts a bare name (legacy
     *  shape, kept so pre-existing callers compile/behave unchanged) OR an
     *  object setting name and/or the tracks_imei_units Settings toggle —
     *  normalized to the object shape before crossing the IPC boundary. */
    updateCategory: (
      id: number,
      data: string | { name?: string; tracks_imei_units?: boolean },
    ) =>
      ipcRenderer.invoke(
        "inventory:update-category",
        id,
        typeof data === "string" ? { name: data } : data,
      ),
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
    updateMetadata: (data: {
      id: number;
      note?: string;
      client_name?: string;
      client_phone?: string;
    }) => ipcRenderer.invoke("sales:update-metadata", data),
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
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
        direction?: "IN" | "OUT";
      }>;
      keptChangeUSD?: number;
      keptChangeLBP?: number;
      transaction_time?: string;
      tender_exchange_rate?: number;
    }) => ipcRenderer.invoke("debt:add-repayment", data),
    cashOut: (data: {
      clientId: number;
      amountUSD: number;
      amountLBP: number;
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
        direction?: "IN" | "OUT";
      }>;
      note?: string;
      transaction_time?: string;
      tender_exchange_rate?: number;
    }) => ipcRenderer.invoke("debt:cash-out", data),
    addAccountEntry: (data: {
      direction: "credit" | "debt";
      clientId: number;
      amountUSD: number;
      amountLBP: number;
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
        direction?: "IN" | "OUT";
      }>;
      note?: string;
      transaction_time?: string;
      /** LIRA-080 — "Cash moved" toggle; default true when omitted. */
      moveCash?: boolean;
    }) => ipcRenderer.invoke("debt:add-account-entry", data),
    updateMetadata: (data: { id: number; note?: string }) =>
      ipcRenderer.invoke("debts:update-metadata", data),
    addCredit: (data: {
      clientId: number;
      amountUsd: number;
      amountLbp: number;
      note?: string;
      transactionTime?: string;
    }) => ipcRenderer.invoke("debt:add-credit", data),
    useCredit: (data: {
      clientId: number;
      amountUsd: number;
      amountLbp: number;
      note?: string;
      transactionTime?: string;
    }) => ipcRenderer.invoke("debt:use-credit", data),
    getClientBalance: (clientId: number) =>
      ipcRenderer.invoke("debt:client-balance", clientId),
    // CQ-10 (D4): standalone write-off — admin-only, no cash movement.
    writeOff: (data: {
      clientId: number;
      amountUSD: number;
      amountLBP: number;
      reason?: string;
    }) => ipcRenderer.invoke("debt:write-off", data),
  },

  // Vouchers (Gift Cards)
  vouchers: {
    create: (data: {
      clientId: number;
      amount: number;
      currency?: "USD" | "LBP";
      expiryDate?: string | null;
      note?: string | null;
    }) => ipcRenderer.invoke("voucher:create", data),
    getAll: (filters?: { status?: string; clientId?: number }) =>
      ipcRenderer.invoke("voucher:get-all", filters),
    validate: (code: string) => ipcRenderer.invoke("voucher:validate", code),
    cancel: (id: number) => ipcRenderer.invoke("voucher:cancel", id),
  },

  // Financial
  financial: {
    getMonthlyPL: (month: string) =>
      ipcRenderer.invoke("financial:get-monthly-pl", month),
    getDrawerNames: () => ipcRenderer.invoke("financial:get-drawer-names"),
    updateMetadata: (data: {
      id: number;
      customer_name?: string;
      phone_number?: string;
      sender_name?: string;
      sender_phone?: string;
      receiver_name?: string;
      receiver_phone?: string;
      note?: string;
    }) => ipcRenderer.invoke("financial:update-metadata", data),
    // LIRA-090 §5.2 — self-charge a telecom catalog item to the shop's own
    // carrier line. Admin only. Fields: mobileServiceItemId (required),
    // carrierLineId (optional — defaults to the item's carrier's primary line),
    // transaction_time (optional).
    selfChargeTelecomItem: (data: {
      mobileServiceItemId: number;
      carrierLineId?: number;
      transaction_time?: string;
    }) => ipcRenderer.invoke("financial:self-charge-telecom-item", data),
  },

  // Exchange
  exchange: {
    addTransaction: (data: {
      fromCurrency: string;
      toCurrency: string;
      amountIn: number;
      amountOut: number;
      leg1Rate: number;
      leg1MarketRate: number;
      leg1ProfitUsd: number;
      leg2Rate?: number;
      leg2MarketRate?: number;
      leg2ProfitUsd?: number;
      viaCurrency?: string;
      totalProfitUsd: number;
      clientName?: string;
      note?: string;
      fromCurrencyName?: string;
      toCurrencyName?: string;
      transaction_time?: string;
      partnerId?: number;
      partnerMode?: "FOR";
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
        direction?: "IN" | "OUT";
      }>;
      tender_exchange_rate?: number;
    }) => ipcRenderer.invoke("exchange:add-transaction", data),
    getHistory: () => ipcRenderer.invoke("exchange:get-history"),
    updateMetadata: (data: {
      id: number;
      client_name?: string;
      note?: string;
    }) => ipcRenderer.invoke("exchange:update-metadata", data),
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
        | "WHISH_APP"
        | "OMT_APP"
        | "BINANCE";
      serviceType: "SEND" | "RECEIVE" | "BILL";
      amount: number;
      currency?: string;
      commission?: number;
      cost?: number;
      price?: number;
      paidByMethod?: string;
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
        voucherCode?: string;
        direction?: "IN" | "OUT";
      }>;
      clientId?: number;
      clientName?: string;
      referenceNumber?: string;
      phoneNumber?: string;
      senderName?: string;
      senderPhone?: string;
      receiverName?: string;
      receiverPhone?: string;
      senderClientId?: number;
      receiverClientId?: number;
      omtServiceType?: string;
      omtFee?: number;
      whishFee?: number;
      profitRate?: number;
      payFee?: boolean;
      itemKey?: string;
      itemCategory?: string;
      note?: string;
      includingFees?: boolean;
      paymentMethodFee?: number;
      paymentMethodFeeRate?: number;
      returnedCreditsUsd?: number;
      partnerId?: number;
      partnerMode?: "THROUGH" | "FOR";
      cashoutMethod?: string;
      transaction_time?: string;
      deferPayment?: boolean;
      /** Payment-Legs Integrity plan (Wave 8): full checkout total for a
       *  multi-unit cart's legs-carrying CARRIER transaction (KatchForm /
       *  FinancialForm). See CreateFinancialServiceData in @liratek/core. */
      checkoutTotal?: { usd: number; lbp: number };
      /** Payment-Legs Integrity plan (Wave 9): the rate MultiPaymentInput
       *  actually converted the customer's tender at (may differ from the
       *  transaction's stamped rate-of-record) — reconciliation uses this
       *  when present. See CreateFinancialServiceData in @liratek/core. */
      tender_exchange_rate?: number;
      /** CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): identifies which
       *  multi-unit split checkout this unit belongs to — sent with EVERY
       *  unit (carrier and siblings alike) by KatchForm/FinancialForm.
       *  Omitted on single-unit checkouts. See CreateFinancialServiceData
       *  in @liratek/core. */
      split_group?: string;
      split_role?: "carrier" | "sibling";
      split_units?: number;
      /** BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.2/§4 Phase C: operator-chosen
       *  fee-collection legs for an OMT/WHISH system RECEIVE with a
       *  fee-on-top (`includingFees` false, fee > 0). Real tender methods,
       *  split allowed, CUSTOMER_ACCOUNT allowed (client-gated). Σ must
       *  equal the transaction's own fee — enforced server-side by a second
       *  reconcileLegs call. Absent entirely (not `[]`) falls back to the
       *  repository's legacy single-leg synthesis on `cashoutMethod`. Never
       *  sent inside a session (the basket path doesn't wire fee collection
       *  through yet — Phase F). See CreateFinancialServiceData in
       *  @liratek/core. */
      feePayments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
      }>;
      /** Rule 12: the repository reads these (FinancialServiceRepository
       *  folds them into the drawer credit and the profit stamp), and
       *  electron.d.ts already declared them — this type was the only link
       *  in the chain missing them. Overpayment the customer chose to leave
       *  with the shop rather than take back as change. */
      kept_change_usd?: number;
      kept_change_lbp?: number;
      /** LIRA-090 (v140) Only-Days fields — rule 12: must be present here
       *  so the Zod schema (FinancialServiceSchema, now updated with these
       *  three fields) does not strip them from the IPC payload and the
       *  computed credit-return feature actually reaches the repository.
       *  `returnedCreditsUsd` already existed above (scalar operator override).
       *  See CreateFinancialServiceData in @liratek/core for the full contract. */
      mobileServiceItemId?: number;
      telecomCreditReturns?: Array<{
        itemCategory?: string;
        mobileServiceItemId?: number;
        returnedCreditsUsd?: number;
      }>;
    }) => ipcRenderer.invoke("omt:add-transaction", data),
    getHistory: (provider?: string) =>
      ipcRenderer.invoke("omt:get-history", provider),
    getAnalytics: (providers?: string[]) =>
      ipcRenderer.invoke("omt:get-analytics", providers),
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
      type:
        | "CREDIT_TRANSFER"
        | "VOUCHER"
        | "DAYS"
        | "ALFA_GIFT"
        | "CREDIT_BUYBACK";
      amount: number;
      cost: number;
      price: number;
      default_price_to_client?: number;
      paid_by_method?: string;
      phoneNumber?: string;
      clientId?: number;
      clientName?: string;
      currency?: string;
      note?: string;
      /** Multi-payment legs — required (non-empty) for `type:
       *  "CREDIT_BUYBACK"` (CARRIER_LINES_VALIDITY_PLAN.md Phase 6). Legs
       *  without `direction` are IN (customer-paid / payout); `direction:
       *  "OUT"` marks a change leg (CLAUDE.md rule 16). */
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
        voucherCode?: string;
        direction?: "IN" | "OUT";
      }>;
      kept_change_usd?: number;
      kept_change_lbp?: number;
      partnerId?: number;
      partnerMode?: "FOR";
      transaction_time?: string;
      /** Payment-Legs Integrity plan (false-reject fix): the rate the
       *  payment sheet actually converted the customer's tender at — used
       *  only for leg reconciliation, never the stamped exchange_rate. */
      tender_exchange_rate?: number;
    }) => ipcRenderer.invoke("recharge:process", data),
    topUpApp: (data: {
      provider:
        | "MTC"
        | "Alfa"
        | "OMT_APP"
        | "WHISH_APP"
        | "OMT_SYSTEM"
        | "WHISH_SYSTEM"
        | "iPick"
        | "Katsh";
      amount: number;
      currency: "USD" | "LBP";
      sourceDrawer: string;
    }) => ipcRenderer.invoke("recharge:top-up-app", data),
    topUpFromSupplier: (data: {
      provider: "iPick" | "Katsh";
      amount: number;
      currency: "USD" | "LBP";
    }) => ipcRenderer.invoke("recharge:top-up-from-supplier", data),
    topUpFromPartner: (data: {
      provider: "WHISH_APP";
      partnerId: number;
      amount: number;
      currency: "USD" | "LBP";
    }) => ipcRenderer.invoke("recharge:top-up-from-partner", data),
    topUpFromClient: (data: {
      amount: number;
      cashPaid: number;
      currency: "USD" | "LBP";
      clientName?: string;
      clientId?: number;
    }) => ipcRenderer.invoke("recharge:top-up-from-client", data),
    updateMetadata: (data: {
      id: number;
      phone_number?: string;
      client_name?: string;
      note?: string;
    }) => ipcRenderer.invoke("recharge:update-metadata", data),
  },

  // Suppliers
  suppliers: {
    list: (search?: string, includeInactive?: boolean) =>
      ipcRenderer.invoke("suppliers:list", search, includeInactive),
    getBalances: (includeInactive?: boolean) =>
      ipcRenderer.invoke("suppliers:balances", includeInactive),
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
    getAllTransactions: (provider: string, limit?: number) =>
      ipcRenderer.invoke("suppliers:all-transactions", provider, limit),
    getUnsettledSummary: () =>
      ipcRenderer.invoke("suppliers:unsettled-summary"),
    settleTransactions: (data: {
      supplier_id: number;
      financial_service_ids: number[];
      amount_usd: number;
      amount_lbp: number;
      commission_usd: number;
      commission_lbp: number;
      // COMMISSION_AT_SETTLEMENT_PLAN.md D8 — entry mode + audit snapshot of
      // the rate/count used for a new-model (commission_model=1) batch.
      // Ignored for a legacy batch. Rule 12: must mirror supplierSettleSchema.
      entry_mode?: "LUMP" | "RATE";
      commission_rate?: number;
      commission_unit_count?: number;
      /** Owner follow-up (2026-08-13) — bills-only batch only: 'TOP_UP'
       *  (default) credits the provider's own drawer, 'OTHER_PAYMENT' means
       *  `payments` below carries the real collection legs instead. Rule 12:
       *  must mirror supplierSettleSchema. */
      commission_collection_mode?: "TOP_UP" | "OTHER_PAYMENT";
      /** @deprecated no longer used to move money — see SupplierRepository.SettleTransactionsData */
      drawer_name?: string;
      note?: string;
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
    }) => ipcRenderer.invoke("suppliers:settle-transactions", data),
    recordCashflow: (data: {
      supplier_id: number;
      direction: "PAY" | "RECEIVE";
      payments: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
      note?: string;
      exchange_rate?: number;
    }) => ipcRenderer.invoke("suppliers:record-cashflow", data),
    // CQ-10 (D4): standalone write-off — admin-only, no cashflow attached.
    writeOff: (data: {
      supplier_id: number;
      amount_usd: number;
      amount_lbp: number;
      reason?: string;
    }) => ipcRenderer.invoke("suppliers:write-off", data),
    getProductBalances: () => ipcRenderer.invoke("suppliers:product-balances"),
    getProductItems: (supplierId: number) =>
      ipcRenderer.invoke("suppliers:product-items", supplierId),
    getPurchases: (supplierId: number) =>
      ipcRenderer.invoke("suppliers:purchases", supplierId),
    createPurchase: (data: {
      supplier_id: number;
      total_usd: number;
      note?: string;
    }) => ipcRenderer.invoke("suppliers:purchase-create", data),
  },

  // Loto
  loto: {
    sell: (data: {
      ticket_number?: string;
      sale_amount: number;
      payments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
        direction?: "IN" | "OUT";
      }>;
      commission_rate?: number;
      is_winner?: boolean;
      prize_amount?: number;
      sale_date?: string;
      payment_method?: string;
      currency?: string;
      note?: string;
      transaction_time?: string;
      clientId?: number | null;
      clientName?: string;
    }) => ipcRenderer.invoke("loto:sell", data),
    get: (id: number) => ipcRenderer.invoke("loto:get", id),
    getByDateRange: (from: string, to: string) =>
      ipcRenderer.invoke("loto:get-by-date-range", from, to),
    getUncheckpointed: () => ipcRenderer.invoke("loto:get-uncheckpointed"),
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
      }) => ipcRenderer.invoke("loto:checkpoints:settle-batch", data),
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
    updateMetadata: (data: { id: number; note?: string }) =>
      ipcRenderer.invoke("loto:update-metadata", data),
  },

  // Maintenance
  maintenance: {
    save: (job: unknown) => ipcRenderer.invoke("maintenance:save", job),
    getJobs: (statusFilter?: string) =>
      ipcRenderer.invoke("maintenance:get-jobs", statusFilter),
    delete: (id: number) => ipcRenderer.invoke("maintenance:delete", id),
    updateMetadata: (data: {
      id: number;
      client_name?: string;
      device_name?: string;
      issue_description?: string;
      note?: string;
    }) => ipcRenderer.invoke("maintenance:update-metadata", data),
  },

  // Closing
  closing: {
    getSystemExpectedBalancesDynamic: () =>
      ipcRenderer.invoke("closing:get-system-expected-balances-dynamic"),
    getCheckpointTimeline: (filters: {
      date_from?: string;
      date_to?: string;
      type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
      drawer_name?: string;
      user_id?: number;
    }) => ipcRenderer.invoke("closing:getCheckpointTimeline", filters),
    getDailyStatsSnapshot: () =>
      ipcRenderer.invoke("closing:get-daily-stats-snapshot"),
    recalculateDrawerBalances: () =>
      ipcRenderer.invoke("closing:recalculate-drawer-balances"),
    // Unified checkpoint API
    createCheckpoint: (data: {
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
      /** Per-line SIM counts, MTC/Alfa only (rule 12 — spelled out in full so
       *  a future refactor cannot silently drop a field). Only the COUNTED
       *  values travel; the expected side is read server-side off
       *  carrier_lines. `counted_expires_at` absent/null = validity was not
       *  counted, and the stored expiry is left untouched. */
      carrier_lines?: Array<{
        carrier_line_id: number;
        counted_credits: number;
        counted_expires_at?: string | null;
      }>;
    }) => ipcRenderer.invoke("closing:create-checkpoint", data),
    getLastCheckpointActuals: () =>
      ipcRenderer.invoke("closing:get-last-checkpoint-actuals"),
    getLastCheckpointPerDrawer: () =>
      ipcRenderer.invoke("closing:get-last-checkpoint-per-drawer"),
    hasOpeningBalanceToday: () =>
      ipcRenderer.invoke("closing:has-opening-balance-today"),
    hasInitialBalancesSet: () =>
      ipcRenderer.invoke("closing:has-initial-balances-set"),
    hasStartingCheckpoint: () =>
      ipcRenderer.invoke("closing:has-starting-checkpoint"),
    getInitialCheckpointDate: () =>
      ipcRenderer.invoke("closing:get-initial-checkpoint-date"),
    updateDailyClosing: (data: any) =>
      ipcRenderer.invoke("closing:update-daily-closing", data),
  },

  // Drawer Top-Up
  drawerTopUp: {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      /** External (Cash In) mode only — top-ups in currencies other than
       *  USD/LBP already enabled for the General drawer (Settings →
       *  Currencies). Not accepted by createFromDrawer (transfer mode). */
      extra_currencies?: {
        currency_code: string;
        amount: number;
        /** EXCHANGE_LOT_SETTLEMENT.md Q3, refined 2026-08-23 — operator
         *  cost-basis override (USD per one unit of currency_code), sent
         *  ONLY when the "edit" link in the top-up modal was used. */
        acquisition_usd_per_unit?: number;
        /** NEW (2026-08-23 refinement) — live-feed USD-per-unit rate,
         *  attached by the frontend for a currency with no configured
         *  exchange_rates row. */
        market_usd_per_unit_hint?: number;
      }[];
    }) => ipcRenderer.invoke("drawer-topup:create", data),
    createFromDrawer: (data: {
      amount_usd: number;
      amount_lbp: number;
      source_drawer: string;
      notes?: string;
    }) => ipcRenderer.invoke("drawer-topup:create-from-drawer", data),
    /** Generic, reversible cash transfer between any two of the shop's own
     *  drawers (Primary Cash Drawer plan §8.6) — General <-> the primary
     *  cash drawer (OMT_System/Whish_System) is the pair the UI exposes.
     *  Replaces the retired `fundSystem` (one-directional, owner-confirmed
     *  2026-07-29 float model). */
    transfer: (data: {
      fromDrawer: string;
      toDrawer: string;
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      transaction_time?: string;
    }) => ipcRenderer.invoke("drawer-topup:transfer", data),
    getSourceDrawers: () => ipcRenderer.invoke("drawer-topup:source-drawers"),
    getHistory: (limit?: number) =>
      ipcRenderer.invoke("drawer-topup:history", { limit }),
  },

  // Drawer Cash-Out
  drawerCashout: {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      extra_currencies?: { currency_code: string; amount: number }[];
      notes: string;
    }) => ipcRenderer.invoke("drawer-cashout:create", data),
    getHistory: (limit?: number) =>
      ipcRenderer.invoke("drawer-cashout:history", { limit }),
  },

  // Wallet Exchange — convert a provider wallet's own USD balance to LBP
  // (or vice versa), OMT App / Whish App only.
  walletExchange: {
    create: (data: {
      drawerName: "OMT_App" | "Whish_App";
      fromCurrency: "USD" | "LBP";
      toCurrency: "USD" | "LBP";
      amountIn: number;
      rate: number;
      note?: string;
    }) => ipcRenderer.invoke("wallet-exchange:create", data),
    getHistory: (drawerName?: "OMT_App" | "Whish_App", limit?: number) =>
      ipcRenderer.invoke("wallet-exchange:history", { drawerName, limit }),
  },

  // Exchange Lots (EXCHANGE_LOT_SETTLEMENT.md Phase 4a) — cost-basis lot
  // tracking read/admin API for exotic-currency exchange positions.
  exchangeLots: {
    preview: (data: {
      currencyCode: string;
      qty: number;
      unitProceedsUsd: number;
      fromCurrency?: string;
    }) => ipcRenderer.invoke("exchange-lots:preview", data),
    getPositions: () => ipcRenderer.invoke("exchange-lots:positions"),
    getBreakdown: (exchangeId: number) =>
      ipcRenderer.invoke("exchange-lots:breakdown", { exchangeId }),
    adjust: (data: {
      currencyCode: string;
      qty: number;
      unitCostUsd?: number;
      note?: string;
    }) => ipcRenderer.invoke("exchange-lots:adjust", data),
  },

  // Product Units (LIRA-143 Phase 5 — phone IMEI units & warranty) —
  // intake/read API over the per-IMEI phone unit tracker.
  productUnits: {
    register: (data: { product_id: number; imeis: string[] }) =>
      ipcRenderer.invoke("product-units:register", data),
    getForProduct: (productId: number, status?: "IN_STOCK" | "SOLD") =>
      ipcRenderer.invoke("product-units:for-product", { productId, status }),
    /** The Phone Units management view — one filters object carries status,
     *  defective narrowing, the IMEI/product-name search term and the page
     *  window. `limit`/`offset` may be omitted; the shared Zod schema
     *  applies 50/0. */
    list: (filters: {
      status?: "IN_STOCK" | "SOLD";
      defectiveOnly?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    }) => ipcRenderer.invoke("product-units:list", filters),
    getSummary: (productIds: number[]) =>
      ipcRenderer.invoke("product-units:summary", {
        product_ids: productIds,
      }),
    delete: (unitId: number) =>
      ipcRenderer.invoke("product-units:delete", { id: unitId }),
    getStory: (imei: string) =>
      ipcRenderer.invoke("product-units:story", { imei }),
    getForSaleItems: (saleItemIds: number[]) =>
      ipcRenderer.invoke("product-units:for-sale-items", {
        sale_item_ids: saleItemIds,
      }),
  },

  // Partners
  partners: {
    getAll: (includeInactive?: boolean) =>
      ipcRenderer.invoke("partners:get-all", includeInactive),
    getById: (id: number) => ipcRenderer.invoke("partners:get-by-id", id),
    create: (data: {
      name: string;
      phone?: string;
      notes?: string;
      system_association?: string | null;
    }) => ipcRenderer.invoke("partners:create", data),
    update: (
      id: number,
      data: {
        name?: string;
        phone?: string;
        notes?: string;
        system_association?: string | null;
      },
    ) => ipcRenderer.invoke("partners:update", id, data),
    deactivate: (id: number) => ipcRenderer.invoke("partners:deactivate", id),
    activate: (id: number) => ipcRenderer.invoke("partners:activate", id),
    getBalance: (partnerId: number) =>
      ipcRenderer.invoke("partners:get-balance", partnerId),
    getAllBalances: (includeInactive?: boolean) =>
      ipcRenderer.invoke("partners:get-all-balances", includeInactive),
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
    ) => ipcRenderer.invoke("partners:get-ledger", partnerId, filters),
    recordTransaction: (data: unknown) =>
      ipcRenderer.invoke("partners:record-transaction", data),
    settle: (data: unknown) => ipcRenderer.invoke("partners:settle", data),
    // CQ-10 (D4): standalone write-off — admin-only, no settlement attached.
    writeOff: (data: {
      partnerId: number;
      amount_usd: number;
      amount_lbp: number;
      reason?: string;
    }) => ipcRenderer.invoke("partners:write-off", data),
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

  // Database path management
  database: {
    isJoinInstallation: () => ipcRenderer.invoke("database:isJoinInstallation"),
    browse: () => ipcRenderer.invoke("database:browse"),
    changePath: (newPath: string) =>
      ipcRenderer.invoke("database:changePath", newPath),
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
    // LIRA-064: each returned row carries a structured `payments` array
    // (in/out legs with currency + method) joined from the payments table.
    // See RecentTransaction / TransactionPaymentLeg in electron.d.ts.
    getRecent: (limit?: number, filters?: Record<string, unknown>) =>
      ipcRenderer.invoke("transactions:get-recent", limit, filters),
    getCashFlowByDate: (from: string, to: string) =>
      ipcRenderer.invoke("transactions:cash-flow-by-date", from, to),
    getById: (id: number) => ipcRenderer.invoke("transactions:get-by-id", id),
    /** LIRA-069 W1.c/d: resolve the unified transaction for a module row
     *  (e.g. sourceTable "recharges", sourceId recharges.id). */
    getBySource: (sourceTable: string, sourceId: number) =>
      ipcRenderer.invoke("transactions:get-by-source", sourceTable, sourceId),
    getCustomerLegs: (id: number) =>
      ipcRenderer.invoke("transactions:get-customer-legs", id),
    getByClient: (clientId: number, limit?: number) =>
      ipcRenderer.invoke("transactions:get-by-client", clientId, limit),
    getByDateRange: (from: string, to: string, type?: string) =>
      ipcRenderer.invoke("transactions:get-by-date-range", from, to, type),
    void: (id: number) => ipcRenderer.invoke("transactions:void", id),
    /** LIRA-078: refundLegs is optional — omit for the default (mirror the
     *  original payment legs verbatim) reversal. LIRA-143 phase 5:
     *  refundUnitExtras is optional too — the phone-refund UI's per-unit
     *  defective/warranty-override flags, riding alongside refundLegs on
     *  the SAME call. */
    refund: (
      id: number,
      refundLegs?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
      }>,
      refundUnitExtras?: Array<{
        unit_id: number;
        is_defective?: boolean;
        warranty_override_until?: string | null;
      }>,
    ) =>
      ipcRenderer.invoke(
        "transactions:refund",
        id,
        refundLegs,
        refundUnitExtras,
      ),
    /** CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): void every non-voided
     *  member of a multi-unit split checkout in ONE transaction. */
    voidCheckoutGroup: (groupId: string) =>
      ipcRenderer.invoke("transactions:void-checkout-group", { groupId }),
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
    countableDrawerCurrencies: () =>
      ipcRenderer.invoke("currencies:countableDrawerCurrencies"),
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
    reorder: (orderedKeys: string[]) =>
      ipcRenderer.invoke("modules:reorder", orderedKeys),
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

  // Service Providers (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phases 4a + 5)
  serviceProviders: {
    list: () => ipcRenderer.invoke("service-providers:list"),
    listActive: () => ipcRenderer.invoke("service-providers:list-active"),
    create: (data: { code: string; label: string }) =>
      ipcRenderer.invoke("service-providers:create", data),
    update: (id: number, data: { label?: string; is_active?: number }) =>
      ipcRenderer.invoke("service-providers:update", id, data),
    delete: (id: number) => ipcRenderer.invoke("service-providers:delete", id),
  },

  // Customer Sessions
  session: {
    start: (data: {
      customer_name: string;
      customer_phone?: string;
      customer_notes?: string;
      started_by: string;
      user_id?: number;
    }) => ipcRenderer.invoke("session:start", data),
    getActive: () => ipcRenderer.invoke("session:getActive"),
    getActiveSessions: () => ipcRenderer.invoke("session:getActiveSessions"),
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
    delete: (sessionId: number) =>
      ipcRenderer.invoke("session:delete", sessionId),
    list: (limit: number, offset: number) =>
      ipcRenderer.invoke("session:list", limit, offset),
    getTodaySessions: () => ipcRenderer.invoke("session:today"),
    getTodayAllSessions: () => ipcRenderer.invoke("session:todayAll"),
    getByDateRange: (from: string, to: string) =>
      ipcRenderer.invoke("session:byDateRange", from, to),
    linkTransaction: (data: {
      transactionType: string;
      transactionId: number;
      amountUsd: number;
      amountLbp: number;
    }) => ipcRenderer.invoke("session:linkTransaction", data),
    checkout: (data: {
      sessionId: number;
      cartItems: Array<{
        id: string;
        module: string;
        label: string;
        amount: number;
        currency: string;
        formData: Record<string, unknown>;
        ipcChannel: string;
      }>;
      paidByMethod?: string;
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
        direction?: "IN" | "OUT";
        voucher_code?: string;
      }>;
      exchangeRate?: number;
      clientId?: number;
      clientName?: string;
      userId: number;
    }) => ipcRenderer.invoke("session:checkout", data),

    // Cart persistence
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
    ) => ipcRenderer.invoke("session:cart:add", sessionId, item),
    cartGet: (sessionId: number) =>
      ipcRenderer.invoke("session:cart:get", sessionId),
    cartRemove: (sessionId: number, itemId: string) =>
      ipcRenderer.invoke("session:cart:remove", sessionId, itemId),
    cartClear: (sessionId: number) =>
      ipcRenderer.invoke("session:cart:clear", sessionId),

    // Aliases / additional bindings
    getTransactions: (sessionId: number) =>
      ipcRenderer.invoke("session:getDetails", sessionId),
    getByCustomer: (data: { customerName: string; customerPhone?: string }) =>
      ipcRenderer.invoke("session:getByCustomer", data),
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
      // W6.b: structured validity/credits (nullable, both optional).
      validity_days?: number | null;
      credits?: number | null;
      // LIRA-090 (v140) Only-Days split columns — nullable, all optional.
      days_cost_lbp?: number | null;
      sell_days_lbp?: number | null;
      sell_credit_lbp?: number | null;
    }) => ipcRenderer.invoke("mobile-service-items:create", data),
    update: (
      id: number,
      data: {
        label?: string;
        cost_lbp?: number;
        sell_lbp?: number;
        sort_order?: number;
        is_active?: number;
        // W6.b: structured validity/credits (nullable, both optional).
        validity_days?: number | null;
        credits?: number | null;
        // LIRA-090 (v140) Only-Days split columns — nullable, all optional.
        days_cost_lbp?: number | null;
        sell_days_lbp?: number | null;
        sell_credit_lbp?: number | null;
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
        validity_days?: number | null;
        credits?: number | null;
        // TELECOM_DAYS_COST_PLAN.md §4.3 — fresh-install Only-Days split cost.
        days_cost_lbp?: number | null;
        // TELECOM_CREDIT_RATE_PLAN.md — fresh-install days-only sell price.
        // Rule 12: this MUST be listed even though TypeScript does not strip
        // properties at runtime, or the next person refactoring the seed
        // payload has no signal the field is meant to be here.
        sell_days_lbp?: number | null;
      }[],
    ) => ipcRenderer.invoke("mobile-service-items:seed", items),
    count: () => ipcRenderer.invoke("mobile-service-items:count"),
  },

  // Carrier Lines (LIRA W6.a — shop SIM-line tracking; informational only,
  // no drawer legs, no checkout/closing involvement)
  carrierLines: {
    getActiveByCarrier: (carrier: "alfa" | "mtc") =>
      ipcRenderer.invoke("carrier-lines:get-active-by-carrier", carrier),
    getAllActive: () => ipcRenderer.invoke("carrier-lines:get-all-active"),
    getAllAdmin: () => ipcRenderer.invoke("carrier-lines:get-all-admin"),
    create: (data: {
      carrier: "alfa" | "mtc";
      phone_number: string;
      label?: string | null;
      credits?: number;
      validity_expires_at?: string | null;
      notes?: string | null;
    }) => ipcRenderer.invoke("carrier-lines:create", data),
    update: (
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
    ) => ipcRenderer.invoke("carrier-lines:update", id, data),
    updateBalance: (
      id: number,
      data: { credits?: number; validity_expires_at?: string | null },
    ) => ipcRenderer.invoke("carrier-lines:update-balance", id, data),
    // LIRA-145: books the consumed credits as a `Line_Usage` expense — a
    // money write, unlike `updateBalance` above which just overwrites the
    // number. Every field the renderer sends is typed here (rule 12).
    recordUsage: (data: {
      carrierLineId: number;
      newCredits: number;
      expectedCurrentCredits?: number;
      note?: string;
    }) => ipcRenderer.invoke("carrier-lines:record-usage", data),
    archive: (id: number) => ipcRenderer.invoke("carrier-lines:archive", id),
    toggleActive: (id: number) =>
      ipcRenderer.invoke("carrier-lines:toggle-active", id),
    // LIRA-090: primary-line support for Only-Days and self-charge flows.
    getPrimary: (carrier: "alfa" | "mtc") =>
      ipcRenderer.invoke("carrier-lines:get-primary", carrier),
    setPrimary: (id: number) =>
      ipcRenderer.invoke("carrier-lines:set-primary", id),
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
      category?: string;
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
        voucher_code?: string;
        direction?: "IN" | "OUT";
      }>;
      partnerId?: number;
      partnerMode?: "FOR";
      /** FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 — set only when the
       *  operator picked a product from the inventory SearchBar; decrements
       *  1 unit of stock. Omitted (preset/free-text) -> NULL -> no stock
       *  movement. */
      product_id?: number;
    }) => ipcRenderer.invoke("custom-services:add", data),
    delete: (id: number) => ipcRenderer.invoke("custom-services:delete", id),
    updateMetadata: (data: {
      id: number;
      description?: string;
      client_name?: string;
      phone_number?: string;
      note?: string;
      category?: string;
    }) => ipcRenderer.invoke("custom-services:update-metadata", data),
  },

  // Hold Money (cash held on behalf of a client)
  holdMoney: {
    list: (filter?: { status?: "held" | "collected" }) =>
      ipcRenderer.invoke("hold-money:list", filter),
    active: () => ipcRenderer.invoke("hold-money:active"),
    create: (data: {
      client_name: string;
      phone_number?: string;
      usd_amount?: number;
      lbp_amount?: number;
      notes?: string;
      transaction_time?: string;
    }) => ipcRenderer.invoke("hold-money:create", data),
    collect: (id: number) => ipcRenderer.invoke("hold-money:collect", id),
  },

  // Service Presets (digital accounts, repairs, etc.)
  servicePresets: {
    list: (filter?: { category?: string; includeInactive?: boolean }) =>
      ipcRenderer.invoke("service-presets:list", filter),
    create: (data: {
      name: string;
      category: string;
      cost_usd?: number;
      cost_lbp?: number;
      price_usd?: number;
      price_lbp?: number;
      is_active?: number;
      sort_order?: number;
    }) => ipcRenderer.invoke("service-presets:create", data),
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
    ) => ipcRenderer.invoke("service-presets:update", { id, data }),
    delete: (id: number) => ipcRenderer.invoke("service-presets:delete", id),
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
    printWithDialog: (html: string) =>
      ipcRenderer.invoke("print:with-dialog", html),
  },
});

console.log("[PRELOAD] window.api exposed successfully");

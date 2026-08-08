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

/** LIRA-077 — one row of the `stock_adjustments` audit trail. */
export type StockAdjustmentEntity = {
  id: number;
  product_id: number;
  delta: number;
  old_quantity: number;
  new_quantity: number;
  reason: string;
  user_id: number | null;
  username: string | null;
  created_at: string;
  updated_at: string;
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
  /** Set on 'Session Debt' rows — the basket this charge belongs to. Null otherwise. */
  session_id: number | null;
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

/** One row of `RechargeRepository.getDrawerBalances()` — the funding-source
 *  picker data for all four recharge top-up arms. Distinct from
 *  `DrawerBalances` above (that one is the dashboard's generalDrawer/
 *  omtDrawer summary, a different repository/shape entirely). */
export type RechargeDrawerBalance = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
  usdtBalance: number;
};

/** One row of `RechargeRepository.getHistory()` — MTC/Alfa recharge history
 *  tab (LIRA-103). Mirrors `RechargeEntity` (packages/core) field-for-field. */
export type RechargeHistoryEntry = {
  id: number;
  carrier: string;
  recharge_type: string;
  amount: number;
  cost: number;
  price: number;
  default_price_to_client: number | null;
  currency_code: string;
  paid_by: string;
  phone_number: string | null;
  client_id: number | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number;
  edited_by: string | null;
  edited_at: string | null;
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

/**
 * NOTE (2026-08-01): `InsufficientDrawerFundsDetails` lived here until the
 * owner reversed the no-overdraw rule — no drawer operation is blocked any
 * more, so nothing throws that error and the shape had no producer. The
 * `code`/`details` envelope fields stay: they are the general AppError
 * contract (rule 19c, IPC and REST identical), and callers must still switch
 * on `code`, never on a message string.
 */

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

/** LIRA W6.a — a shop-owned alfa/mtc SIM line. Informational only. */
export type CarrierLineEntity = {
  id: number;
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  notes: string | null;
  is_active: number;
  /** LIRA-090 (v140): 1 if this is the primary line for its carrier.
   *  At most one primary per carrier per tenant. Set via setPrimaryCarrierLine. */
  is_primary: number;
  created_at: string;
  updated_at: string;
};

export type CarrierLineWriteResult = {
  success: boolean;
  data?: CarrierLineEntity;
  error?: string;
};

/** LIRA W6.b — a mobile service catalog item (dynamic pricing catalog). */
export type MobileServiceItemEntity = {
  id: number;
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order: number;
  is_active: number;
  validity_days: number | null;
  credits: number | null;
  /** LIRA-090 (v140): LBP cost attributable to validity days alone (spec §2.3).
   *  Null until a shop admin fills in the split. */
  days_cost_lbp: number | null;
  /** LIRA-090 (v140): customer-facing price when only the days are sold. */
  sell_days_lbp: number | null;
  /** LIRA-090 (v140): decision-aid display price for resold recovered credit
   *  (spec §2.4). Null until configured. */
  sell_credit_lbp: number | null;
  created_at: string;
  updated_at: string;
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
  }) => Promise<{ success: boolean; checkpoints?: any[]; error?: string }>;
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
  createClient: (payload: {
    full_name: string;
    phone_number?: string;
    whatsapp_opt_in?: number | boolean;
    [key: string]: unknown;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  deleteClient: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Inventory / Products
  // ---------------------------------------------------------------------------
  getProducts: (search?: string) => Promise<any[]>;
  createProduct: (payload: any) => Promise<ProductWriteResult>;
  updateProduct: (id: number, payload: any) => Promise<ProductWriteResult>;
  deleteProduct: (id: number) => Promise<ProductWriteResult>;
  getLowStockProducts: () => Promise<any[]>;
  /** LIRA-077: set-absolute (newQuantity) or delta stock correction, always
   *  with a reason for the stock_adjustments audit trail. */
  adjustStock: (payload: {
    id: number;
    newQuantity?: number;
    delta?: number;
    reason: string;
  }) => Promise<{ success: boolean; error?: string }>;
  /** LIRA-077: adjustment history — one product, or the most recent across
   *  all products when productId is omitted. */
  getStockAdjustments: (productId?: number) => Promise<StockAdjustmentEntity[]>;

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
    transaction_time?: string;
    /** Owner decision (2026-08-08) — the USD/LBP rate the operator actually
     *  tendered at, stamped onto the transaction (packages/core/src/validators/debt.ts
     *  addRepaymentSchema's `tender_exchange_rate`). */
    tender_exchange_rate?: number;
    /** CQ-10: bundled discount — forgives part of the debt alongside the
     *  cash payment. Posts a signed-profit 'Debt Discount' ledger row. */
    discount?: { amount_usd: number; amount_lbp: number; reason?: string };
  }) => Promise<ApiResult>;
  /** CQ-10: standalone debt write-off (admin-only) — pure forgiveness, no
   *  cash movement. Capped server-side at the client's outstanding balance
   *  per currency. */
  debtWriteOff: (payload: {
    clientId: number;
    // NOTE camelCase — mirrors debtWriteOffSchema/addRepaymentSchema's
    // amountUSD/amountLBP convention (unlike suppliers/partners write-off,
    // which use amount_usd/amount_lbp).
    amountUSD: number;
    amountLBP: number;
    reason?: string;
  }) => Promise<ApiResult & { id?: number }>;
  getClientBalance: (clientId: number) => Promise<{
    success: boolean;
    data?: { balance_usd: number; balance_lbp: number };
    error?: string;
  }>;
  cashOut: (
    payload: unknown,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  addAccountEntry: (
    payload: unknown,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  /** Consume a client's prepaid credit balance (IPC: debt.useCredit). */
  consumeCredit: (payload: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note?: string;
    transactionTime?: string;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  /** Edit a debt_ledger row's note (IPC: debt.updateMetadata). */
  updateDebtMetadata: (payload: {
    id: number;
    note?: string;
  }) => Promise<{ success: boolean; data?: any; error?: string }>;

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
  /** MTC/Alfa recharge history for the history tab (LIRA-103). Previously a
   *  raw, unguarded `window.api.recharge.getHistory()` call with no REST
   *  twin, so it silently yielded an empty history list in web mode. */
  getRechargeHistory: (
    provider: "MTC" | "Alfa",
  ) => Promise<RechargeHistoryEntry[]>;
  processRecharge: (payload: any) => Promise<ApiResult>;
  /** Funding-source drawer balances for the top-up modal opened by
   *  `handleTopUpClick` — feeds all four top-up arms below. Previously a
   *  raw, unguarded `window.api.recharge.getDrawerBalances()` call with no
   *  REST twin, so the modal never opened in web mode. */
  getRechargeDrawerBalances: () => Promise<RechargeDrawerBalance[]>;
  /** Generic drawer-to-drawer top-up into a provider drawer (desktop's only
   *  path to `OMT_App` — CARRIER_LINES_VALIDITY_PLAN.md §8.3). */
  topUpApp: (payload: {
    provider: "OMT_APP" | "WHISH_APP" | "iPick" | "Katsh";
    amount: number;
    currency: "USD" | "LBP";
    sourceDrawer: string;
  }) => Promise<ApiResult>;
  /** Katsh/iPick: the supplier extends credit — no source drawer moves. */
  topUpFromSupplier: (payload: {
    provider: "iPick" | "Katsh";
    amount: number;
    currency: "USD" | "LBP";
  }) => Promise<ApiResult>;
  /** Whish App: a partner extends credit — no source drawer moves. */
  topUpFromPartner: (payload: {
    provider: "WHISH_APP";
    partnerId: number;
    amount: number;
    currency: "USD" | "LBP";
  }) => Promise<ApiResult>;
  /** Whish App: a client transfers credits, paid cash out of General. */
  topUpFromClient: (payload: {
    amount: number;
    cashPaid: number;
    currency: "USD" | "LBP";
    clientName?: string;
    clientId?: number;
  }) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Services (OMT / Whish / BOB)
  // ---------------------------------------------------------------------------
  getOMTHistory: (provider?: string) => Promise<any[]>;
  getOMTAnalytics: (providers?: string[]) => Promise<any>;
  /** RECEIVE payouts can be blocked with `code: "INSUFFICIENT_DRAWER_FUNDS"`
   *  (Primary Cash Drawer plan §8.5) when the primary cash drawer lacks
   *  funds in the payout currency — `details` carries the shortfall so the
   *  caller can offer a "move from General" action. Switch on `code`, never
   *  the message string. */
  addOMTTransaction: (
    payload: any,
  ) => Promise<ApiResult & { id?: number; code?: string; details?: unknown }>;
  /** Generic, reversible cash transfer between any two of the shop's own
   *  drawers (Primary Cash Drawer plan §8.6) — General <-> the primary cash
   *  drawer (OMT_System/Whish_System) is the pair the UI exposes. Replaces
   *  the retired `drawerTopUp.fundSystem` (one-directional float-funding,
   *  now-superseded 2026-07-29 model). Can itself fail with
   *  `code: "INSUFFICIENT_DRAWER_FUNDS"` if `fromDrawer` lacks funds. */
  transferBetweenDrawers: (data: {
    fromDrawer: string;
    toDrawer: string;
    amount_usd: number;
    amount_lbp: number;
    notes?: string;
    transaction_time?: string;
  }) => Promise<ApiResult & { id?: number; code?: string; details?: unknown }>;

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
    /** Per-line SIM counts, MTC/Alfa only (carrier-lines-validity Phase 3).
     *  Only counted values cross the wire; the expected side is read
     *  server-side off carrier_lines. */
    carrier_lines?: Array<{
      carrier_line_id: number;
      counted_credits: number;
      counted_expires_at?: string | null;
    }>;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
  getCheckpointTimeline: (filters?: {
    date_from?: string;
    date_to?: string;
    type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
    drawer_name?: string;
    user_id?: number;
  }) => Promise<{ success: boolean; checkpoints?: any[]; error?: string }>;
  getInitialCheckpointDate: () => Promise<string | null>;
  /** Per-drawer last-checkpoint status (staleness badges, dashboard). Raw
   *  Record — null when unavailable (non-critical read). */
  getLastCheckpointPerDrawer: () => Promise<Record<
    string,
    {
      drawer_name: string;
      checked_at: string;
      amounts: Record<string, { physical: number; expected: number }>;
    }
  > | null>;
  /** Whether initial drawer amounts have ever been set (setup banner). */
  hasInitialBalancesSet: () => Promise<boolean>;
  /** Whether a starting (session-management) checkpoint has ever been recorded. */
  hasStartingCheckpoint: () => Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------
  getSuppliers: (search?: string, includeInactive?: boolean) => Promise<any[]>;
  getSupplierBalances: (includeInactive?: boolean) => Promise<any[]>;
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
    /** @deprecated no longer used to move money — see SupplierRepository.SettleTransactionsData */
    drawer_name?: string;
    note?: string;
    payments?: Array<{ method: string; currency_code: string; amount: number }>;
  }) => Promise<ApiResult & { id?: number }>;
  /** Pay a supplier down / record a supplier paying us, via payment legs. */
  recordSupplierCashflow: (data: {
    supplier_id: number;
    direction: "PAY" | "RECEIVE";
    payments: Array<{ method: string; currency_code: string; amount: number }>;
    note?: string;
    exchange_rate?: number;
    /** CQ-10: bundled discount — PAY direction only (backend rejects it on
     *  RECEIVE). Posts a signed-profit 'DISCOUNT' supplier_ledger row. */
    discount?: { amount_usd: number; amount_lbp: number; reason?: string };
  }) => Promise<ApiResult & { id?: number }>;
  /** CQ-10: standalone supplier write-off (admin-only) — the supplier
   *  forgives what we owe them; capped server-side at the outstanding
   *  balance per currency. */
  supplierWriteOff: (data: {
    supplier_id: number;
    amount_usd: number;
    amount_lbp: number;
    reason?: string;
  }) => Promise<ApiResult & { id?: number }>;
  /** All transactions for a provider (history tab) — settled + unsettled. */
  getAllSupplierTransactions: (
    provider: string,
    limit?: number,
  ) => Promise<any[]>;
  /** Per-provider unsettled commission summary (dashboard + profits page). */
  getUnsettledSummary: () => Promise<any[]>;
  /** Product-supplier aggregate balances (Inventory-linked suppliers). */
  getSupplierProductBalances: () => Promise<any[]>;
  /** Inventory items sourced from one product supplier. */
  getSupplierProductItems: (supplierId: number) => Promise<any[]>;
  /** Purchase (delivery batch) records for a product supplier. */
  getSupplierPurchases: (supplierId: number) => Promise<any[]>;
  /**
   * Log a delivery batch for a product supplier (FIFO payment coverage).
   * NOTE: core SupplierService.createPurchase returns the raw entity on
   * success (no `success` wrapper) and only `{ success: false, error }` on
   * failure — this passes the result through unchanged, it does not reshape.
   */
  createSupplierPurchase: (data: {
    supplier_id: number;
    total_usd: number;
    note?: string;
  }) => Promise<any>;

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
  reorderModules: (orderedKeys: string[]) => Promise<ApiResult>;

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
  // Carrier Lines (LIRA W6.a — shop SIM-line tracking; informational only)
  // ---------------------------------------------------------------------------
  getActiveCarrierLines: (
    carrier: "alfa" | "mtc",
  ) => Promise<CarrierLineEntity[]>;
  getAllActiveCarrierLines: () => Promise<CarrierLineEntity[]>;
  getAdminCarrierLines: () => Promise<CarrierLineEntity[]>;
  createCarrierLine: (data: {
    carrier: "alfa" | "mtc";
    phone_number: string;
    label?: string | null;
    credits?: number;
    validity_expires_at?: string | null;
    notes?: string | null;
  }) => Promise<CarrierLineWriteResult>;
  updateCarrierLine: (
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
  ) => Promise<CarrierLineWriteResult>;
  /** Recharge-tab inline quick-update: credits and/or a new expiry date. */
  updateCarrierLineBalance: (
    id: number,
    data: { credits?: number; validity_expires_at?: string | null },
  ) => Promise<CarrierLineWriteResult>;
  archiveCarrierLine: (id: number) => Promise<CarrierLineWriteResult>;
  toggleCarrierLineActive: (id: number) => Promise<CarrierLineWriteResult>;
  /** LIRA-090: get the current primary line for a carrier (null when none
   *  is configured). Read-only. */
  getPrimaryCarrierLine: (carrier: "alfa" | "mtc") => Promise<{
    success: boolean;
    data?: CarrierLineEntity | null;
    error?: string;
  }>;
  /** LIRA-090: designate a line as the primary for its carrier (admin only).
   *  Atomically clears the previous holder. */
  setPrimaryCarrierLine: (id: number) => Promise<CarrierLineWriteResult>;

  // ---------------------------------------------------------------------------
  // Mobile Service Items — admin (LIRA W6.b) + LIRA-090
  // ---------------------------------------------------------------------------
  /** Active catalog items (public read — no role gate). */
  getActiveMobileServiceItems: () => Promise<MobileServiceItemEntity[]>;
  getAdminMobileServiceItems: () => Promise<MobileServiceItemEntity[]>;
  /** LIRA-090: create a new catalog item (admin only). */
  createMobileServiceItem: (data: {
    provider: string;
    category: string;
    subcategory: string;
    label: string;
    cost_lbp: number;
    sell_lbp: number;
    sort_order?: number;
    is_active?: number;
    validity_days?: number | null;
    credits?: number | null;
    days_cost_lbp?: number | null;
    sell_days_lbp?: number | null;
    sell_credit_lbp?: number | null;
  }) => Promise<{
    success: boolean;
    data?: MobileServiceItemEntity;
    error?: string;
  }>;
  updateMobileServiceItem: (
    id: number,
    data: {
      label?: string;
      cost_lbp?: number;
      sell_lbp?: number;
      sort_order?: number;
      is_active?: number;
      validity_days?: number | null;
      credits?: number | null;
      /** LIRA-090 (v140) Only-Days split columns — nullable, all optional. */
      days_cost_lbp?: number | null;
      sell_days_lbp?: number | null;
      sell_credit_lbp?: number | null;
    },
  ) => Promise<{
    success: boolean;
    data?: MobileServiceItemEntity;
    error?: string;
  }>;
  /** LIRA-090 §5.2: charge a telecom catalog item to the shop's own carrier
   *  line. No customer is debited; debits the iPick/Katsh LBP drawer.
   *  Admin or staff only. */
  selfChargeTelecomItem: (data: {
    mobileServiceItemId: number;
    carrierLineId?: number;
    transaction_time?: string;
  }) => Promise<{
    success: boolean;
    data?: {
      transactionId: number;
      carrierLineId: number;
      costLbp: number;
      creditsAdded: number;
      validityDaysAdded: number;
    };
    error?: string;
  }>;

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

  /** Nested namespace mirroring window.api.session (read + cart + checkout),
   *  so the session page/context call identical names on IPC and REST. */
  session: {
    getActiveSessions: () => Promise<{
      success: boolean;
      sessions?: any[];
      error?: string;
    }>;
    getTodaySessions: () => Promise<any>;
    getTodayAllSessions: () => Promise<any>;
    getByDateRange: (from: string, to: string) => Promise<any>;
    getByCustomer: (data: {
      customerName: string;
      customerPhone?: string;
    }) => Promise<any>;
    delete: (sessionId: number) => Promise<ApiResult>;
    getTransactions: (sessionId: number) => Promise<any>;
    cartGet: (sessionId: number) => Promise<{
      success: boolean;
      items?: any[];
      error?: string;
    }>;
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
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    cartRemove: (sessionId: number, itemId: string) => Promise<ApiResult>;
    cartClear: (sessionId: number) => Promise<ApiResult>;
    checkout: (data: unknown) => Promise<any>;
  };

  /** Hold money — cash held in / collected out of the General drawer. */
  holdMoney: {
    list: (filter?: {
      status?: "held" | "collected";
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    active: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    create: (data: {
      client_name: string;
      phone_number?: string;
      usd_amount?: number;
      lbp_amount?: number;
      notes?: string;
      transaction_time?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    collect: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  /** Service presets — config CRUD for custom-service templates. */
  servicePresets: {
    list: (filter?: {
      category?: string;
      includeInactive?: boolean;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (data: {
      name: string;
      category: string;
      cost_usd?: number;
      cost_lbp?: number;
      price_usd?: number;
      price_lbp?: number;
      is_active?: number;
      sort_order?: number;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
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
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };

  /** Audit log — read-only user-action audit trail. */
  audit: {
    getRecent: (
      limit?: number,
    ) => Promise<{ success: boolean; rows?: any[]; error?: string }>;
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
    }) => Promise<{
      success: boolean;
      rows?: any[];
      total?: number;
      error?: string;
    }>;
    getByEntity: (
      entityType: string,
      entityId: string,
    ) => Promise<{ success: boolean; rows?: any[]; error?: string }>;
  };

  /** Partners — config records + partner_ledger money writes.
   *  Reads return RAW values (array / statement object) mirroring the IPC
   *  handlers; writes return the { success, data? } envelope. */
  partners: {
    getAll: (includeInactive?: boolean) => Promise<any[]>;
    getById: (id: number) => Promise<any>;
    getAllBalances: (includeInactive?: boolean) => Promise<any[]>;
    getBalance: (partnerId: number) => Promise<any>;
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
    ) => Promise<any>;
    create: (data: {
      name: string;
      phone?: string;
      notes?: string;
      system_association?: string | null;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: {
        name?: string;
        phone?: string;
        notes?: string;
        is_active?: number;
        system_association?: string | null;
      },
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deactivate: (id: number) => Promise<{ success: boolean; error?: string }>;
    activate: (id: number) => Promise<{ success: boolean; error?: string }>;
    recordTransaction: (data: {
      partnerId: number;
      transactionType?: string;
      referenceTable?: string;
      referenceId?: number;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
      notes?: string;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    settle: (data: {
      partnerId: number;
      amount: number;
      currency: string;
      settlementMethod: string;
      notes?: string;
      /** CQ-10: bundled discount — forgives part of what the partner owes
       *  alongside the settlement. Posts a signed-profit 'DISCOUNT' row. */
      discount?: { amount_usd: number; amount_lbp: number; reason?: string };
      /** CQ-11 — split-leg settlement (MultiPaymentInput); supersedes
       *  `settlementMethod` for money movement when present. Every leg's
       *  currency_code must match `currency` and legs must sum to `amount`. */
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    /** CQ-10: standalone partner write-off (admin-only) — we forgive what
     *  the partner owes us; capped server-side at the outstanding balance
     *  per currency. */
    writeOff: (data: {
      partnerId: number;
      amount_usd: number;
      amount_lbp: number;
      reason?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
  };

  /** Vouchers (gift cards) — config CRUD. Channels return the service
   *  envelope directly ({ success, voucher?/vouchers?, error? }). */
  vouchers: {
    getAll: (filters?: {
      status?: string;
      clientId?: number;
    }) => Promise<{ success: boolean; vouchers?: any[]; error?: string }>;
    create: (data: {
      clientId: number;
      amount: number;
      currency?: "USD" | "LBP";
      expiryDate?: string | null;
      note?: string | null;
    }) => Promise<{ success: boolean; voucher?: any; error?: string }>;
    validate: (
      code: string,
    ) => Promise<{ success: boolean; voucher?: any; error?: string }>;
    cancel: (
      id: number,
    ) => Promise<{ success: boolean; voucher?: any; error?: string }>;
  };

  /** Drawer top-ups — cash into a drawer / transfer between drawers. */
  drawerTopUp: {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      /** External (Cash In) mode only — top-ups in currencies other than
       *  USD/LBP already enabled for the General drawer. Not accepted by
       *  createFromDrawer (transfer mode). */
      extra_currencies?: { currency_code: string; amount: number }[];
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    createFromDrawer: (data: {
      amount_usd: number;
      amount_lbp: number;
      source_drawer: string;
      notes?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getSourceDrawers: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    getHistory: (
      limit?: number,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  };

  /** Drawer cash-out — pull physical cash OUT of the General drawer (owner's draw). */
  drawerCashout: {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      notes: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getHistory: (
      limit?: number,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  };

  /** Wallet exchange — convert a provider wallet's OWN USD balance to LBP
   *  (or vice versa), OMT App / Whish App only, never General. */
  walletExchange: {
    create: (data: {
      drawerName: "OMT_App" | "Whish_App";
      fromCurrency: "USD" | "LBP";
      toCurrency: "USD" | "LBP";
      amountIn: number;
      rate: number;
      note?: string;
    }) => Promise<{
      success: boolean;
      id?: number;
      amountOut?: number;
      error?: string;
    }>;
    getHistory: (
      drawerName?: "OMT_App" | "Whish_App",
      limit?: number,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  };

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
    category?: string;
    transaction_time?: string;
    /** Operator-edited USD↔LBP rate of record — stamped verbatim onto the
     *  transaction; omitted falls back to a live snapshot rate. */
    exchange_rate?: number;
    /** LIRA-081: for-partner custom service — no counter payment, the FULL
     *  price books to the partner's tab instead. */
    partnerId?: number;
    partnerMode?: "FOR";
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
  /** LIRA-069 W1.c/d: resolve the unified transaction for a module row. */
  getTransactionBySource: (
    sourceTable: string,
    sourceId: number,
  ) => Promise<any>;
  getClientTransactions: (clientId: number, limit?: number) => Promise<any[]>;
  voidTransaction: (id: number) => Promise<ApiResult & { reversalId?: number }>;
  /** LIRA-078: `refundLegs` is optional — omit for the default reversal
   *  (mirrors the original payment legs verbatim); pass one entry per
   *  currency to let the operator choose the return method (method-override
   *  only — amount/currencyCode must net to the original's own total). */
  refundTransaction: (
    id: number,
    refundLegs?: Array<{
      method: string;
      currencyCode: string;
      amount: number;
    }>,
  ) => Promise<ApiResult & { refundId?: number }>;
  /** CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): void every non-voided
   *  member of a multi-unit split checkout in ONE transaction. */
  voidCheckoutGroup: (groupId: string) => Promise<
    ApiResult & {
      groupId?: string;
      memberCount?: number;
      voidedTransactionIds?: number[];
      reversalIds?: number[];
    }
  >;
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

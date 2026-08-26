/**
 * LIRA-143 Phase 5 — one `product_units` row (per-IMEI phone unit
 * tracking). Mirrors `@liratek/core`'s `ProductUnitEntity`
 * (packages/core/src/repositories/ProductUnitRepository.ts) verbatim
 * (rule 14).
 */
export interface ProductUnit {
  id: number;
  tenant_id: number | null;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  sale_item_id: number | null;
  is_defective: number;
  warranty_override_until: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-product IN_STOCK/SOLD/defective rollup — see
 *  `ProductUnitRepository.getSummaryForProducts`'s doc for why a unit-less
 *  product gets no key at all rather than a zeroed entry. */
export interface ProductUnitSummary {
  in_stock: number;
  sold: number;
  defective: number;
}

/** The walk-in lookup row (decision #7) — a `ProductUnit` joined with its
 *  sale provenance and computed warranty status. */
export interface ProductUnitStory extends ProductUnit {
  product_name: string | null;
  /** The owning MODEL's warranty term (`products.warranty_months`) —
   *  display-only (decision #4 starts the clock at the sale), never a
   *  coverage claim. */
  product_warranty_months: number | null;
  warranty_until: string | null;
  is_refunded: number | null;
  refunded_quantity: number | null;
  quantity: number | null;
  sold_price_usd: number | null;
  sale_id: number | null;
  sold_at: string | null;
  client_id: number | null;
  client_name: string | null;
  warranty: {
    source: "OVERRIDE" | "REFUND" | "SALE" | null;
    until: string | null;
    state: "COVERED" | "EXPIRED" | "VOID" | "NONE";
  };
}

/** One row of the Phone Units management view: the unit's own columns, its
 *  product model's name, the sale provenance it was last sold on, and the
 *  computed warranty verdict. Every sale-side field is `null` for a unit
 *  that has never been sold — `sale_refunded` included, which is how "never
 *  sold" stays distinguishable from "sold and not refunded" (`0`). */
export interface ProductUnitListRow {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  is_defective: number;
  warranty_override_until: string | null;
  created_at: string;
  product_name: string;
  /** The owning MODEL's warranty term (`products.warranty_months`) —
   *  display-only, so unsold stock can show "N mo — starts at sale" instead
   *  of "No warranty". Never a coverage claim (decision #4). */
  product_warranty_months: number | null;
  sale_item_id: number | null;
  sold_at: string | null;
  sold_price_usd: number | null;
  client_name: string | null;
  warranty_until: string | null;
  sale_refunded: 0 | 1 | null;
  warranty: {
    source: "OVERRIDE" | "REFUND" | "SALE" | null;
    until: string | null;
    state: "COVERED" | "EXPIRED" | "VOID" | "NONE";
  };
}

/** One page of {@link ProductUnitListRow}s plus the UNPAGED total over the
 *  same filters — the pager's denominator. */
export interface ProductUnitListResult {
  rows: ProductUnitListRow[];
  total: number;
}

/** Filter/page payload for the Phone Units management view.
 *  `limit`/`offset` may be omitted — the shared Zod schema applies 50/0. */
export interface ProductUnitListFilters {
  status?: "IN_STOCK" | "SOLD";
  defectiveOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/** A voucher / gift card */
export interface Voucher {
  id: number;
  code: string;
  client_id: number;
  client_name: string;
  client_phone: string | null;
  amount: number;
  currency_code: string;
  expiry_date: string | null;
  status: "pending" | "redeemed" | "expired" | "cancelled";
  redeemed_at: string | null;
  redeemed_by: number | null;
  redeemed_in_transaction: string | null;
  redeemed_transaction_id: number | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
  note: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

/**
 * EXCHANGE_LOT_SETTLEMENT.md Phase 4b — per-currency cost-basis lot summary
 * attached to an exchange history row. `SourceSummary` (a row that CREATED a
 * lot, i.e. an exotic-currency BUY leg) extends `SettlerSummary` (a row that
 * CONSUMED lot(s), i.e. an exotic-currency SELL leg) with the source lot's
 * own remaining/voided state. Mirrors `@liratek/core`'s
 * `SettlerSummary`/`SourceSummary` (packages/core/src/services/ExchangeService.ts)
 * verbatim (rule 14).
 */
export interface SettlerSummary {
  settled_qty: number;
  realized_profit_usd: number;
}

/** @see SettlerSummary */
export interface SourceSummary extends SettlerSummary {
  original_qty: number;
  remaining_qty: number;
  is_voided: number;
}

/** A single financial_services row as returned by the Suppliers history tab. */
export interface SupplierTransaction {
  id: number;
  service_type: "SEND" | "RECEIVE" | "BILL";
  amount: number;
  currency: string;
  commission: number;
  cost: number;
  omt_service_type: string | null;
  omt_fee: number | null;
  settlement_id: number | null;
  is_settled: number;
  /**
   * Repository-computed owed-per-row (SUPPLIER_OWED_EXPR): 0 for
   * wallet-provider transfers, cost for cost-flow rows, amount + provider
   * fee for OMT/WHISH SEND, amount + commission for RECEIVE.
   */
  supplier_owed: number;
  fifo_status: "paid" | "partial" | "unpaid";
  fifo_paid_usd: number;
  created_at: string;
  /** Display-only LEFT JOIN enrichment (FinancialServiceRepository.getAllByProvider)
   *  — this row's per-currency share of the commission entered at settlement
   *  time, for a settled BILL row whose own `commission` column is 0 by
   *  design (commission is entered AT settlement, not creation). */
  settled_commission_usd?: number | null;
  /** @see settled_commission_usd */
  settled_commission_lbp?: number | null;
}

/**
 * LIRA-064: a single structured in/out payment leg for a transaction.
 *
 * `direction` is from the shop's perspective: `"in"` is money the customer
 * paid, `"out"` is money the shop returned/disbursed. `amount` is the absolute
 * value; `signed_amount` preserves the original signed payment amount.
 *
 * This shape is shared with the backend (TransactionPaymentLeg) and is designed
 * to also power a future expandable detail row (LIRA-067) with no data changes.
 */
export interface TransactionPaymentLeg {
  direction: "in" | "out";
  amount: number;
  signed_amount: number;
  currency_code: string;
  method: string;
}

/**
 * LIRA-064: a row from the unified transactions journal as returned by
 * `window.api.transactions.getRecent`, including the structured `payments`
 * array. Only the fields the renderer relies on are typed explicitly; the
 * remaining journal columns are passed through.
 */
export interface RecentTransaction {
  id: number;
  type: string;
  status: string;
  source_table: string;
  source_id: number;
  user_id: number;
  amount_usd: number;
  amount_lbp: number;
  exchange_rate: number | null;
  client_id: number | null;
  client_phone: string | null;
  reverses_id: number | null;
  summary: string | null;
  metadata_json: string | null;
  device_id: string | null;
  created_at: string;
  username: string;
  client_name: string | null;
  /** Set when this transaction belongs to a customer-session basket (WS8). */
  session_id: number | null;
  payments: TransactionPaymentLeg[];
  /**
   * CUSTOMER_ACCOUNT settlement of a session basket, sourced from debt_ledger
   * (never written to `payments` — a non-drawer method has no drawer leg to
   * record). Only present on session rows with an on-account portion.
   */
  account_payments?: TransactionPaymentLeg[];
}

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
  /** Structured validity (days) — LIRA W6.b. Null when not applicable. */
  validity_days: number | null;
  /** Structured credit amount (USD) — LIRA W6.b. Null when not applicable. */
  credits: number | null;
  /** LIRA-090 (v140): LBP cost attributable to validity days alone (spec §2.3).
   *  Null until a shop admin fills in the split. */
  days_cost_lbp: number | null;
  /** LIRA-090 (v140): customer-facing price when only the days are sold.
   *  Null until configured. */
  sell_days_lbp: number | null;
  /** LIRA-090 (v140): decision-aid display price for resold recovered credit
   *  (spec §2.4). Null until configured. */
  sell_credit_lbp: number | null;
  created_at: string;
  updated_at: string;
}

/** A shop-owned alfa/mtc SIM line (LIRA W6.a, extended by LIRA-090 v140). */
export interface CarrierLine {
  id: number;
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  notes: string | null;
  is_active: number;
  /** LIRA-090 (v140): 1 if this is the primary line for its carrier (receives
   *  automated Only-Days credit returns and self-charges by default). At most
   *  one primary per carrier per tenant — enforced by a partial unique index.
   *  Set via `window.api.carrierLines.setPrimary(id)`. */
  is_primary: number;
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

export interface Partner {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: number;
  system_association: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A `service_providers` config row (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md
 * §5b phase 4a) — powers the Partners "System Association" dropdown with
 * the real, tenant-scoped provider list instead of a hardcoded pair.
 */
export interface ServiceProviderEntity {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  /** 1 = OMT/WHISH — eligible for Primary-Cash-Drawer routing; 0 otherwise. */
  is_system_provider: number;
  sort_order: number;
  is_active: number;
  is_system: number;
  created_at: string;
}

/**
 * All `partner_ledger.transaction_type` values that may be returned for display.
 *
 * Plain types + SETTLEMENT/ADJUSTMENT/CUSTOM_SERVICE are recordable manually
 * (see Partners "Record Transaction"). The `THROUGH_*` / `FOR_*` variants are
 * written automatically by real OMT/Whish transactions (LIRA-047) and remain
 * here so historical ledger rows stay type-safe even though they are no longer
 * offered in the manual dropdown (LIRA-051).
 */
export type PartnerTransactionType =
  | "OMT_SEND"
  | "OMT_RECEIVE"
  | "WHISH_SEND"
  | "WHISH_RECEIVE"
  | "THROUGH_OMT_SEND"
  | "THROUGH_OMT_RECEIVE"
  | "THROUGH_WHISH_SEND"
  | "THROUGH_WHISH_RECEIVE"
  | "FOR_OMT_SEND"
  | "FOR_OMT_RECEIVE"
  | "FOR_WHISH_SEND"
  | "FOR_WHISH_RECEIVE"
  | "FOR_POS"
  | "FOR_RECHARGE"
  | "FOR_KATSH"
  | "FOR_IPICK"
  | "FOR_OMT_APP_SEND"
  | "FOR_OMT_APP_RECEIVE"
  | "FOR_WHISH_APP_SEND"
  | "FOR_WHISH_APP_RECEIVE"
  | "FOR_BINANCE_SEND"
  | "FOR_BINANCE_RECEIVE"
  | "FOR_LOTO"
  | "CUSTOM_SERVICE"
  | "WHISH_TOPUP"
  | "SETTLEMENT"
  | "ADJUSTMENT";

export interface PartnerLedgerEntry {
  id: number;
  partner_id: number;
  transaction_type: PartnerTransactionType;
  reference_table: string | null;
  reference_id: number | null;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
  notes: string | null;
  user_id: number | null;
  settlement_method: string | null;
  created_at: string;
  // Enriched from financial_services JOIN (null when not linked)
  fs_provider: string | null;
  fs_service_type: string | null;
  fs_amount: number | null;
  fs_currency: string | null;
  fs_fee: number | null;
  fs_customer: string | null;
  fs_reference_number: string | null;
  fs_phone_number: string | null;
}

export interface PartnerBalance {
  usd: number;
  lbp: number;
  usdt: number;
}

export interface PartnerBalanceBreakdown {
  usd: { for: number; through: number; other: number; total: number };
  lbp: { for: number; through: number; other: number; total: number };
  usdt: { for: number; through: number; other: number; total: number };
}

export interface LedgerFilters {
  startDate?: string;
  endDate?: string;
  type?: string;
  mode?: "FOR" | "THROUGH";
  provider?: string;
  direction?: "DEBIT" | "CREDIT";
}

export interface PartnerWithBalance extends Partner, PartnerBalance {}

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
    onSessionExpired: (callback: () => void) => () => void;
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
      transaction_time?: string;
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
        // LIRA-131: now projected by ExpenseRepository.getColumns().
        is_refunded?: number;
        refunded_at?: string | null;
      }>
    >;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    updateMetadata: (data: {
      id: number;
      description?: string;
      category?: string;
      note?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
  inventory: {
    getProducts: (
      search?: string,
      filters?: import("@liratek/core").ProductListFilters,
    ) => Promise<Array<import("@liratek/core").Product>>;
    getProductFilterOptions: () => Promise<{
      categories: string[];
      suppliers: string[];
    }>;
    getProduct: (id: number) => Promise<import("@liratek/core").Product | null>;
    getProductByBarcode: (
      barcode: string,
    ) => Promise<import("@liratek/core").Product | null>;
    /** LIRA-143 Phase 3 (owner decision #2): barcode first, then an active
     *  (IN_STOCK) unit IMEI. `matched_unit` is null on a barcode hit. */
    resolveScanCode: (code: string) => Promise<{
      success: boolean;
      data?: {
        product: import("@liratek/core").Product;
        matched_unit: ProductUnit | null;
      } | null;
      error?: string;
    }>;
    createProduct: (product: {
      barcode?: string | null;
      name: string;
      category: string;
      category_id?: number | null;
      cost_price: number;
      retail_price: number;
      whish_price?: number;
      stock_quantity?: number;
      min_stock_level?: number;
      image_url?: string | null;
      item_type?: string;
      supplier?: string | null;
      is_active?: number;
    }) => Promise<{
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
    adjustStock: (payload: {
      id: number;
      newQuantity?: number;
      delta?: number;
      reason: string;
    }) => Promise<{ success: boolean; error?: string }>;
    getStockAdjustments: (productId?: number) => Promise<
      Array<{
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
      }>
    >;
    getStockStats: () => Promise<{
      stock_budget_usd: number;
      stock_count: number;
    }>;
    getLowStockProducts: () => Promise<Array<import("@liratek/core").Product>>;
    getNegativeStock: () => Promise<
      Array<{
        id: number;
        name: string;
        barcode: string | null;
        stock_quantity: number;
      }>
    >;
    getCategories: () => Promise<string[]>;
    getCategoriesFull: () => Promise<
      Array<{
        id: number;
        name: string;
        sort_order: number;
        is_active: number;
        /** LIRA-143 v157 (decision #9): products in this category require
         *  per-unit IMEI tracking when set. */
        tracks_imei_units: number;
      }>
    >;
    createCategory: (
      name: string,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    /** LIRA-143 Phase 5 (decision #9): a bare name (legacy shape) OR an
     *  object setting name and/or the tracks_imei_units Settings toggle. */
    updateCategory: (
      id: number,
      data: string | { name?: string; tracks_imei_units?: boolean },
    ) => Promise<{ success: boolean; updated?: boolean; error?: string }>;
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
    create: (client: {
      full_name: string;
      phone_number: string;
      notes?: string | null;
      whatsapp_opt_in?: boolean | number;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
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
        duplicatesSkipped: number;
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
    updateMetadata: (data: {
      id: number;
      note?: string;
      client_name?: string;
      client_phone?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
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
        /** Set on 'Session Debt' rows — the basket this charge belongs to. Null otherwise. */
        session_id: number | null;
        // LIRA-131: now projected by DebtRepository.getColumns().
        is_refunded?: number;
        refunded_at?: string | null;
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
        direction?: "IN" | "OUT";
      }>;
      transaction_time?: string;
      tender_exchange_rate?: number;
      /** CQ-10: bundled discount — forgives part of the debt alongside the
       *  cash payment. Posts a signed-profit 'Debt Discount' ledger row. */
      discount?: { amount_usd: number; amount_lbp: number; reason?: string };
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    /** CQ-10: standalone debt write-off (admin-only) — pure forgiveness, no
     *  cash movement. Capped server-side at the client's outstanding balance
     *  per currency. */
    writeOff: (data: {
      clientId: number;
      // NOTE camelCase (unlike suppliers/partners write-off): mirrors
      // debtWriteOffSchema/addRepaymentSchema's existing amountUSD/amountLBP
      // convention — reconciled against the sibling's landed core schema
      // (packages/core/src/validators/debt.ts) rather than the ticket's
      // generic amount_usd/amount_lbp shorthand.
      amountUSD: number;
      amountLBP: number;
      reason?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
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
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
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
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getClientBalance: (clientId: number) => Promise<{
      success: boolean;
      data?: { balance_usd: number; balance_lbp: number };
      error?: string;
    }>;
    getClientTotal: (clientId: number) => Promise<number>;
    updateMetadata: (data: {
      id: number;
      note?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    addCredit: (data: {
      clientId: number;
      amountUsd: number;
      amountLbp: number;
      note?: string;
      transactionTime?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    useCredit: (data: {
      clientId: number;
      amountUsd: number;
      amountLbp: number;
      note?: string;
      transactionTime?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getClientBalance: (clientId: number) => Promise<{
      success: boolean;
      data?: { balance_usd: number; balance_lbp: number };
      error?: string;
    }>;
  };

  // Vouchers (Gift Cards)
  vouchers: {
    create: (data: {
      clientId: number;
      amount: number;
      currency?: "USD" | "LBP";
      expiryDate?: string | null;
      note?: string | null;
    }) => Promise<{ success: boolean; voucher?: Voucher; error?: string }>;
    getAll: (filters?: {
      status?: "pending" | "redeemed" | "expired" | "cancelled";
      clientId?: number;
    }) => Promise<{ success: boolean; vouchers?: Voucher[]; error?: string }>;
    validate: (
      code: string,
    ) => Promise<{ success: boolean; voucher?: Voucher; error?: string }>;
    cancel: (
      id: number,
    ) => Promise<{ success: boolean; voucher?: Voucher; error?: string }>;
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
    updateMetadata: (data: {
      id: number;
      customer_name?: string;
      phone_number?: string;
      sender_name?: string;
      sender_phone?: string;
      receiver_name?: string;
      receiver_phone?: string;
      note?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    /** LIRA-090 §5.2: charge a telecom catalog item to the shop's own carrier
     *  line (no customer, no sale row, no profit). Admin only.
     *  Debits the item's `cost_lbp` from the iPick/Katsh drawer and credits
     *  the item's full `credits` (USD) + `validity_days` to the target line. */
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
  };

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
    }) => Promise<{
      success: boolean;
      id?: number;
      error?: string;
      /**
       * EXCHANGE_LOT_SETTLEMENT.md Phase 3 — the SERVER-computed realized
       * profit for a lot-tracked toCurrency sell leg (mirrors
       * `ExchangeOpResult` in packages/core/src/services/ExchangeService.ts).
       * Wins over the client's pre-submit spread estimate when present.
       */
      realizedProfitUsd?: number;
      lotCoveredQty?: number;
      lotMarketQty?: number;
    }>;
    getHistory: () => Promise<
      Array<{
        id: number;
        created_at: string;
        from_currency: string;
        to_currency: string;
        rate: number;
        amount_in: number;
        amount_out: number;
        // LIRA-131: now projected by ExchangeRepository.getColumns().
        is_refunded?: number;
        refunded_at?: string | null;
        /** EXCHANGE_LOT_SETTLEMENT.md Phase 4b — populated when this
         *  exchange created a lot (exotic-currency BUY leg); null otherwise. */
        lot_summary: SourceSummary | null;
        /** @see lot_summary — populated when this exchange consumed lot(s)
         *  (exotic-currency SELL leg); null otherwise. */
        settler_summary: SettlerSummary | null;
      }>
    >;
    updateMetadata: (data: {
      id: number;
      client_name?: string;
      note?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };

  // Binance
  binance: {
    addTransaction: (data: {
      type: "SEND" | "RECEIVE";
      amount: number;
      currencyCode?: string;
      description?: string;
      clientName?: string;
    }) => Promise<{
      success: boolean;
      id?: number;
      error?: string;
      // Primary Cash Drawer plan §8.5 — structured error contract carried
      // through FinancialService so the RECEIVE insufficient-funds panel can
      // switch on `code` instead of matching an error message string.
      code?: string;
      details?: unknown;
    }>;
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
    /**
     * NOTE (rule 12 parity pass, float-model fix 2026-07-30): this ambient
     * type previously described a stale `amountUSD`/`amountLBP`/
     * `commissionUSD`/`commissionLBP` shape that never matched
     * `electron-app/preload.ts`'s real `omt:add-transaction` signature — the
     * only caller, `addOMTTransaction` in `frontend/src/api/backendApi.ts`,
     * has always bypassed this type via `(window as any).api.omt
     * .addTransaction(payload)`, so the mismatch was silently inert. Rewritten
     * here to mirror preload.ts's actual parameter shape (including
     * omtFee/whishFee/includingFees — direction-agnostic, SEND and RECEIVE
     * both read them, per the owner's 2026-07-29 float-model decision) so the
     * two no longer drift if the `any` cast is ever removed.
     */
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
      /** Fee charged by OMT (user-entered or auto-looked-up). No SEND-only
       *  gate — a RECEIVE can carry this fee too (float model). */
      omtFee?: number;
      /** Fee charged by WHISH (user-entered). Same direction-agnostic note
       *  as omtFee above. */
      whishFee?: number;
      profitRate?: number;
      payFee?: boolean;
      itemKey?: string;
      itemCategory?: string;
      note?: string;
      /** true = fee already netted into amount/payout; false/omitted = fee
       *  on top. Applies to SEND and RECEIVE alike. */
      includingFees?: boolean;
      paymentMethodFee?: number;
      paymentMethodFeeRate?: number;
      returnedCreditsUsd?: number;
      /** LIRA-090 (v140): catalog item id — presence signals an Only-Days
       *  telecom sale and drives the computed returned-credit default plus
       *  the primary carrier-line movement. See spec §5.1/§8. */
      mobileServiceItemId?: number;
      /** LIRA-090 (v140): per-line returned-credits array for the walk-in
       *  aggregated cart path (spec §6 bug 2 groundwork). One entry per
       *  Only-Days line in the cart. */
      telecomCreditReturns?: Array<{
        itemCategory?: string;
        mobileServiceItemId?: number;
        returnedCreditsUsd?: number;
      }>;
      partnerId?: number;
      partnerMode?: "THROUGH" | "FOR";
      cashoutMethod?: string;
      kept_change_usd?: number;
      kept_change_lbp?: number;
      transaction_time?: string;
      deferPayment?: boolean;
      checkoutTotal?: { usd: number; lbp: number };
      tender_exchange_rate?: number;
      split_group?: string;
      split_role?: "carrier" | "sibling";
      split_units?: number;
      /** BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.2/§4 Phase C: operator-chosen
       *  fee-collection legs for an OMT/WHISH system RECEIVE with a
       *  fee-on-top (`includingFees` false, fee > 0). Real tender methods,
       *  split allowed, CUSTOMER_ACCOUNT allowed (client-gated). Absent
       *  entirely (not `[]`) falls back to the repository's legacy
       *  single-leg synthesis on `cashoutMethod`. Never sent inside a
       *  session (Phase F). */
      feePayments?: Array<{
        method: string;
        currencyCode: string;
        amount: number;
      }>;
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
        edited_by: string | null;
        edited_at: string | null;
        // LIRA-131: now projected by RechargeRepository.getColumns().
        is_refunded?: number;
        refunded_at?: string | null;
      }>
    >;
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
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
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
    }) => Promise<{ success: boolean; error?: string }>;
    topUpFromSupplier: (data: {
      provider: "iPick" | "Katsh";
      amount: number;
      currency: "USD" | "LBP";
    }) => Promise<{ success: boolean; error?: string }>;
    topUpFromPartner: (data: {
      provider: "WHISH_APP";
      partnerId: number;
      amount: number;
      currency: "USD" | "LBP";
    }) => Promise<{ success: boolean; error?: string }>;
    topUpFromClient: (data: {
      amount: number;
      cashPaid: number;
      currency: "USD" | "LBP";
      clientName?: string;
      clientId?: number;
    }) => Promise<{ success: boolean; error?: string }>;
    getDrawerBalances: () => Promise<
      Array<{
        name: string;
        usdBalance: number;
        lbpBalance: number;
        usdtBalance: number;
      }>
    >;
    updateMetadata: (data: {
      id: number;
      phone_number?: string;
      client_name?: string;
      note?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };

  // Suppliers
  suppliers: {
    list: (
      search?: string,
      includeInactive?: boolean,
    ) => Promise<
      Array<{
        id: number;
        name: string;
        contact_name: string | null;
        phone: string | null;
        note: string | null;
        is_active: number;
        module_key: string | null;
        provider: string | null;
        is_system: number;
        created_at: string;
        /** COMMISSION_AT_SETTLEMENT_PLAN.md D8 — Settlement UI's LUMP/RATE pre-select. */
        commission_entry_mode?: "LUMP" | "RATE";
        commission_rate?: number | null;
        /** LIRA-112 (D12, v151) — does this supplier earn commission at all
         *  (0 = never, e.g. iPick; 1 = yes, e.g. Katsh/every other supplier). */
        commission_eligible?: number;
        /** LIRA-112 (v151) — the currency `commission_rate` is denominated in. */
        commission_rate_currency?: "USD" | "LBP";
      }>
    >;
    getBalances: (
      includeInactive?: boolean,
    ) => Promise<
      Array<{ supplier_id: number; total_usd: number; total_lbp: number }>
    >;
    getLedger: (
      supplierId: number,
      limit?: number,
    ) => Promise<
      Array<{
        id: number;
        supplier_id: number;
        entry_type:
          | "TOP_UP"
          | "PAYMENT"
          | "ADJUSTMENT"
          | "SETTLEMENT"
          | "SALE_COST"
          | "CASH_PRIZE";
        amount_usd: number;
        amount_lbp: number;
        note: string | null;
        created_by: number | null;
        transaction_id: number | null;
        transaction_type: string | null;
        is_refunded?: number;
        refunded_at?: string | null;
        created_at: string;
        /** Display-only LEFT JOIN enrichment (SupplierRepository.getSupplierLedger)
         *  — the batch commission collected at a bills-only settlement, when
         *  this row IS that settlement's SETTLEMENT row. Not a ledger amount;
         *  never summed into the balance. */
        settlement_commission_usd?: number | null;
        /** @see settlement_commission_usd */
        settlement_commission_lbp?: number | null;
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
        /** Repository-computed owed-per-row (SUPPLIER_OWED_EXPR). */
        supplier_owed: number;
        created_at: string;
      }>
    >;
    getAllTransactions: (
      provider: string,
      limit?: number,
    ) => Promise<SupplierTransaction[]>;
    getUnsettledSummary: () => Promise<
      Array<{
        provider: string;
        count: number;
        pending_commission_usd: number;
        pending_commission_lbp: number;
        total_owed_usd: number;
        total_owed_lbp: number;
        /** COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 1 — count of unsettled
         *  BILL rows in this provider's bucket (feeds RATE × count entry). */
        bill_count: number;
      }>
    >;
    settleTransactions: (data: {
      supplier_id: number;
      financial_service_ids: number[];
      amount_usd: number;
      amount_lbp: number;
      commission_usd: number;
      commission_lbp: number;
      // COMMISSION_AT_SETTLEMENT_PLAN.md D8 — entry mode + audit snapshot of
      // the rate/count used for a new-model (commission_model=1) batch.
      // Ignored for a legacy batch.
      entry_mode?: "LUMP" | "RATE";
      commission_rate?: number;
      commission_unit_count?: number;
      /** Owner follow-up (2026-08-13) — bills-only batch only: 'TOP_UP'
       *  (default) credits the provider's own drawer, 'OTHER_PAYMENT' means
       *  `payments` below carries the real collection legs instead. See
       *  SupplierRepository.SettleTransactionsData for the full contract. */
      commission_collection_mode?: "TOP_UP" | "OTHER_PAYMENT";
      /** @deprecated no longer used to move money — see SupplierRepository.SettleTransactionsData */
      drawer_name?: string;
      note?: string;
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
        direction?: "IN" | "OUT";
      }>;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
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
      /** CQ-10: bundled discount — PAY direction only (backend rejects it on
       *  RECEIVE). Posts a signed-profit 'DISCOUNT' supplier_ledger row. */
      discount?: { amount_usd: number; amount_lbp: number; reason?: string };
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    /** CQ-10: standalone supplier write-off (admin-only) — the supplier
     *  forgives what we owe them; capped server-side at the outstanding
     *  balance per currency. */
    writeOff: (data: {
      supplier_id: number;
      amount_usd: number;
      amount_lbp: number;
      reason?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getProductBalances: () => Promise<
      Array<{ supplier_id: number; total_usd: number; total_lbp: number }>
    >;
    getProductItems: (supplierId: number) => Promise<
      Array<{
        product_id: number;
        name: string;
        quantity: number;
        cost: number;
        total: number;
        created_at: string;
      }>
    >;
    getPurchases: (supplierId: number) => Promise<
      Array<{
        id: number;
        supplier_id: number;
        total_usd: number;
        paid_usd: number;
        status: "PAID" | "PARTIAL" | "UNPAID";
        note: string | null;
        created_by: number | null;
        created_at: string;
        updated_at: string;
      }>
    >;
    createPurchase: (data: {
      supplier_id: number;
      total_usd: number;
      note?: string;
    }) => Promise<
      | { success: boolean; id?: number; error?: string }
      | {
          id: number;
          supplier_id: number;
          total_usd: number;
          paid_usd: number;
          status: "PAID" | "PARTIAL" | "UNPAID";
          note: string | null;
          created_by: number | null;
          created_at: string;
          updated_at: string;
        }
    >;
  };

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
          direction?: "IN" | "OUT";
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
    updateMetadata: (data: {
      id: number;
      note?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };

  // Maintenance
  maintenance: {
    save: (job: {
      id?: number;
      device_name: string;
      issue_description: string;
      cost_usd: number;
      price_usd: number;
      cost_lbp?: number;
      price_lbp?: number;
      currency?: "USD" | "LBP";
      client_id?: number | null;
      client_name?: string;
      client_phone?: string;
      discount_usd?: number;
      final_amount_usd?: number;
      final_amount_lbp?: number;
      paid_usd?: number;
      paid_lbp?: number;
      exchange_rate?: number;
      status?: "Received" | "In_Progress" | "Ready" | "Delivered";
      transaction_time?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getJobs: (statusFilter?: string) => Promise<
      Array<{
        id: number;
        device_name: string;
        issue_description: string;
        cost_usd: number;
        price_usd: number;
        cost_lbp: number;
        price_lbp: number;
        currency: string;
        final_amount_lbp?: number;
        client_name?: string;
        client_phone?: string;
        status: string;
        created_at: string;
        paid_usd: number;
        paid_lbp: number;
      }>
    >;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    updateMetadata: (data: {
      id: number;
      client_name?: string;
      device_name?: string;
      issue_description?: string;
      note?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
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
      date_from?: string;
      date_to?: string;
      type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
      drawer_name?: string;
      user_id?: number;
    }) => Promise<{
      success: boolean;
      checkpoints?: Array<{
        id: number;
        closing_date: string;
        drawer_name: string;
        checkpoint_type: "OPENING" | "CLOSING" | "CHECKPOINT";
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
      /** Per-line SIM counts, MTC/Alfa only (carrier-lines-validity Phase 3). */
      carrier_lines?: Array<{
        carrier_line_id: number;
        counted_credits: number;
        counted_expires_at?: string | null;
      }>;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getLastCheckpointActuals: () => Promise<{
      success: boolean;
      data?: Record<string, Record<string, number>>;
      error?: string;
    }>;
    getLastCheckpointPerDrawer: () => Promise<{
      success: boolean;
      data?: Record<
        string,
        {
          drawer_name: string;
          checked_at: string;
          amounts: Record<string, { physical: number; expected: number }>;
        }
      >;
      error?: string;
    }>;
    hasOpeningBalanceToday: () => Promise<boolean>;
    hasInitialBalancesSet: () => Promise<boolean>;
    hasStartingCheckpoint: () => Promise<boolean>;
    getInitialCheckpointDate: () => Promise<string | null>;
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
  };

  // Drawer Top-Up
  drawerTopUp: {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      transaction_time?: string;
      /** External (Cash In) mode only — see preload.ts doc. */
      extra_currencies?: {
        currency_code: string;
        amount: number;
        /** EXCHANGE_LOT_SETTLEMENT.md Q3, refined 2026-08-23 — operator
         *  cost-basis override, sent only via the modal's "edit" link. */
        acquisition_usd_per_unit?: number;
        /** NEW (2026-08-23 refinement) — live-feed USD-per-unit rate for a
         *  currency with no configured exchange_rates row. */
        market_usd_per_unit_hint?: number;
      }[];
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    createFromDrawer: (data: {
      amount_usd: number;
      amount_lbp: number;
      source_drawer: string;
      notes?: string;
      transaction_time?: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    /** Generic, reversible cash transfer between any two of the shop's own
     *  drawers (Primary Cash Drawer plan §8.6) — General <-> the primary
     *  cash drawer (OMT_System/Whish_System) is the pair the UI exposes.
     *  Replaces the retired `fundSystem` (one-directional, owner-confirmed
     *  2026-07-29 float model). `code`/`details` surface
     *  any AppError's structured payload (the general envelope contract) —
     *  switch on `code`, never a message string match. */
    transfer: (data: {
      fromDrawer: string;
      toDrawer: string;
      amount_usd: number;
      amount_lbp: number;
      notes?: string;
      transaction_time?: string;
    }) => Promise<{
      success: boolean;
      id?: number;
      error?: string;
      code?: string;
      details?: unknown;
    }>;
    getSourceDrawers: () => Promise<{
      success: boolean;
      data?: Array<{
        drawer_name: string;
        balance_usd: number;
        balance_lbp: number;
      }>;
      error?: string;
    }>;
    getHistory: (limit?: number) => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        amount_usd: number;
        amount_lbp: number;
        notes: string | null;
        created_by: number;
        created_at: string;
      }>;
      error?: string;
    }>;
  };

  // Drawer Cash-Out
  drawerCashout: {
    create: (data: {
      amount_usd: number;
      amount_lbp: number;
      notes: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    getHistory: (limit?: number) => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        amount_usd: number;
        amount_lbp: number;
        notes: string;
        created_by: number | null;
        created_at: string;
        updated_at: string;
      }>;
      error?: string;
    }>;
  };

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
    }) => Promise<{
      success: boolean;
      id?: number;
      amountOut?: number;
      error?: string;
    }>;
    getHistory: (
      drawerName?: "OMT_App" | "Whish_App",
      limit?: number,
    ) => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        drawer_name: "OMT_App" | "Whish_App";
        from_currency: "USD" | "LBP";
        to_currency: "USD" | "LBP";
        amount_in: number;
        amount_out: number;
        rate: number;
        note: string | null;
        created_by: number | null;
        is_refunded: number;
        refunded_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      error?: string;
    }>;
  };

  // Exchange Lots (EXCHANGE_LOT_SETTLEMENT.md Phase 4a) — cost-basis lot
  // tracking read/admin API for exotic-currency exchange positions.
  exchangeLots: {
    preview: (data: {
      currencyCode: string;
      qty: number;
      unitProceedsUsd: number;
      /** The exchange's fromCurrency — lets the server detect a cross pair
       *  (both sides non-USD) with no USD rate anchor and skip a fabricated
       *  preview (reason: "NO_RATE_ANCHOR") rather than mirroring reality. */
      fromCurrency?: string;
    }) => Promise<
      | { success: true; lotTracked: false; reason?: "NO_RATE_ANCHOR" }
      | {
          success: true;
          lotTracked: true;
          marketUnitCostUsd: number;
          settlements: Array<{
            id: number | null;
            lot_id: number | null;
            basis_source: "LOT" | "MARKET";
            qty: number;
            unit_cost_usd: number;
            unit_proceeds_usd: number;
            profit_usd: number;
          }>;
          realizedProfitUsd: number;
          coveredQty: number;
          marketQty: number;
        }
      | { success: false; error: string }
    >;
    getPositions: () => Promise<{
      success: boolean;
      data?: Array<{
        currency_code: string;
        open_qty: number;
        avg_unit_cost_usd: number;
        lot_count: number;
        current_market_unit_usd: number | null;
        unrealized_profit_usd: number | null;
      }>;
      error?: string;
    }>;
    getBreakdown: (exchangeId: number) => Promise<{
      success: boolean;
      data?: {
        asSettler: Array<{
          id: number;
          tenant_id: number | null;
          lot_id: number | null;
          basis_source: "LOT" | "MARKET";
          settled_by_table: string;
          settled_by_id: number;
          qty: number;
          unit_cost_usd: number;
          unit_proceeds_usd: number;
          profit_usd: number;
          is_refunded: number;
          refunded_at: string | null;
          created_at: string;
          updated_at: string;
          lot_acquired_at: string | null;
          lot_source_table: string | null;
          lot_source_id: number | null;
        }>;
        againstSource: Array<{
          id: number;
          tenant_id: number | null;
          lot_id: number | null;
          basis_source: "LOT" | "MARKET";
          settled_by_table: string;
          settled_by_id: number;
          qty: number;
          unit_cost_usd: number;
          unit_proceeds_usd: number;
          profit_usd: number;
          is_refunded: number;
          refunded_at: string | null;
          created_at: string;
          updated_at: string;
        }>;
      };
      error?: string;
    }>;
    adjust: (data: {
      currencyCode: string;
      qty: number;
      unitCostUsd?: number;
      note?: string;
    }) => Promise<{
      success: boolean;
      data?: {
        adjustment: {
          id: number;
          tenant_id: number | null;
          currency_code: string;
          qty: number;
          unit_cost_usd: number | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        lot?: {
          id: number;
          tenant_id: number | null;
          currency_code: string;
          drawer_name: string;
          source_type: "EXCHANGE_BUY" | "DRAWER_TOPUP" | "ADJUSTMENT";
          source_table: string | null;
          source_id: number | null;
          original_qty: number;
          remaining_qty: number;
          unit_cost_usd: number;
          acquired_at: string;
          is_voided: number;
          created_at: string;
          updated_at: string;
        };
        consume?: {
          settlements: Array<{
            id: number | null;
            lot_id: number | null;
            basis_source: "LOT" | "MARKET";
            qty: number;
            unit_cost_usd: number;
            unit_proceeds_usd: number;
            profit_usd: number;
          }>;
          realizedProfitUsd: number;
          coveredQty: number;
          marketQty: number;
        };
      };
      error?: string;
    }>;
  };

  // Product Units (LIRA-143 Phase 5 — phone IMEI units & warranty) —
  // intake/read API over the per-IMEI phone unit tracker.
  productUnits: {
    register: (data: { product_id: number; imeis: string[] }) => Promise<{
      success: boolean;
      data?: {
        units: ProductUnit[];
        drift: {
          inStockUnits: number;
          stockQuantity: number;
          matches: boolean;
        };
      };
      error?: string;
    }>;
    getForProduct: (
      productId: number,
      status?: "IN_STOCK" | "SOLD",
    ) => Promise<{ success: boolean; data?: ProductUnit[]; error?: string }>;
    /** The Phone Units management view — filtered, paginated, warranty-
     *  stamped units across all products. */
    list: (filters: ProductUnitListFilters) => Promise<{
      success: boolean;
      data?: ProductUnitListResult;
      error?: string;
    }>;
    getSummary: (productIds: number[]) => Promise<{
      success: boolean;
      data?: Record<number, ProductUnitSummary>;
      error?: string;
    }>;
    delete: (unitId: number) => Promise<{ success: boolean; error?: string }>;
    getStory: (
      imei: string,
    ) => Promise<{
      success: boolean;
      data?: ProductUnitStory[];
      error?: string;
    }>;
    /** Phase 6 refund UI — the units linked to a sale being refunded. */
    getForSaleItems: (
      saleItemIds: number[],
    ) => Promise<{ success: boolean; data?: ProductUnit[]; error?: string }>;
  };

  // Session
  session: {
    start: (data: {
      customer_name?: string;
      customer_phone?: string;
      customer_notes?: string;
      started_by: string;
      user_id?: number;
    }) => Promise<{ success: boolean; sessionId?: number; error?: string }>;
    getActiveSessions: () => Promise<{
      success: boolean;
      sessions?: Array<{
        id: number;
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
        user_id?: number;
        started_at: string;
        closed_at?: string;
        started_by: string;
        closed_by?: string;
        is_active: 1 | 0;
      }>;
      error?: string;
    }>;
    close: (
      sessionId: number,
      closedBy: string,
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (
      sessionId: number,
    ) => Promise<{ success: boolean; error?: string }>;
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
      paidByMethod: string;
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
        direction?: "IN" | "OUT";
        voucher_code?: string;
      }>;
      /** Operator-edited Money-IN exchange rate (1 USD = X LBP). */
      exchangeRate?: number;
      clientId?: number;
      clientName?: string;
      userId: number;
    }) => Promise<{
      success: boolean;
      results?: Array<{
        cartItemId: string;
        module: string;
        transactionId: number;
        success: boolean;
        error?: string;
      }>;
      checkoutTotal?: number;
      itemCount?: number;
      error?: string;
    }>;
    getTransactions: (sessionId: number) => Promise<{
      success: boolean;
      transactions?: any[];
      error?: string;
    }>;
    getTodaySessions: () => Promise<{
      success: boolean;
      sessions?: Array<{
        id: number;
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
        started_at: string;
        closed_at?: string;
        started_by: string;
        closed_by?: string;
        is_active: 0 | 1;
        checkout_total_usd: number;
        checkout_total_lbp: number;
        checkout_profit_usd: number;
        checkout_profit_lbp: number;
        item_count: number;
        total_usd: number;
        total_lbp: number;
        total_profit_usd: number;
        total_profit_lbp: number;
      }>;
      error?: string;
    }>;
    getTodayAllSessions: () => Promise<{
      success: boolean;
      sessions?: Array<{
        id: number;
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
        started_at: string;
        closed_at?: string;
        started_by: string;
        closed_by?: string;
        is_active: 0 | 1;
      }>;
      error?: string;
    }>;
    getByDateRange: (
      from: string,
      to: string,
    ) => Promise<{
      success: boolean;
      sessions?: Array<{
        id: number;
        customer_name?: string;
        customer_phone?: string;
        customer_notes?: string;
        started_at: string;
        closed_at?: string;
        started_by: string;
        closed_by?: string;
        is_active: 0 | 1;
        checkout_total_usd: number;
        checkout_total_lbp: number;
        checkout_profit_usd: number;
        checkout_profit_lbp: number;
        item_count: number;
        total_usd: number;
        total_lbp: number;
        total_profit_usd: number;
        total_profit_lbp: number;
      }>;
      error?: string;
    }>;
    getByCustomer: (data: {
      customerName: string;
      customerPhone?: string | undefined;
    }) => Promise<{ success: boolean; sessions?: any[]; error?: string }>;

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
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    cartGet: (sessionId: number) => Promise<{
      success: boolean;
      items?: Array<{
        id: number;
        session_id: number;
        item_id: string;
        module: string;
        label: string;
        amount: number;
        currency: string;
        form_data: string;
        ipc_channel: string;
        user_id?: number;
        created_at: string;
      }>;
      error?: string;
    }>;
    cartRemove: (
      sessionId: number,
      itemId: string,
    ) => Promise<{ success: boolean; error?: string }>;
    cartClear: (
      sessionId: number,
    ) => Promise<{ success: boolean; error?: string }>;
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
    setDrawerCurrencies: (
      drawerName: string,
      currencies: string[],
    ) => Promise<{ success: boolean; error?: string }>;
  };

  // Transactions
  transactions: {
    list: (filter?: { date?: string; type?: string }) => Promise<any[]>;
    get: (id: number) => Promise<any | null>;
    getById: (id: number) => Promise<any | null>;
    /** LIRA-069 W1.c/d: resolve the unified transaction for a module row
     *  (e.g. sourceTable "recharges", sourceId recharges.id). */
    getBySource: (sourceTable: string, sourceId: number) => Promise<any | null>;
    /** RCP-3: customer-facing payment legs for one transaction (service receipts). */
    getCustomerLegs: (id: number) => Promise<
      Array<{
        method: string;
        currency_code: string;
        amount: number;
        direction: "IN" | "OUT";
      }>
    >;
    // LIRA-064: returns the unified journal rows, each with a structured
    // `payments` array (in/out legs joined from the payments table). The
    // handler returns the raw array (no { success } envelope).
    getRecent: (
      limit?: number,
      filters?: Record<string, unknown>,
    ) => Promise<RecentTransaction[]>;
    getCashFlowByDate: (
      from: string,
      to: string,
    ) => Promise<
      Array<{
        date: string;
        currency_code: string;
        total_in: number;
        total_out: number;
      }>
    >;
    void: (id: number) => Promise<{
      success: boolean;
      reversalId?: number;
      error?: string;
    }>;
    /** LIRA-078: refundLegs is optional — omit for the default reversal
     *  (mirrors the original payment legs verbatim); when provided, each
     *  entry overrides the return method for one currency (method-override
     *  only — amount/currencyCode must net to the original's own total).
     *  LIRA-143 phase 5: refundUnitExtras is optional too — the phone-refund
     *  UI's per-unit defective/warranty-override flags, riding alongside
     *  refundLegs on the SAME call. */
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
    ) => Promise<{
      success: boolean;
      refundId?: number;
      error?: string;
    }>;
    /** CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): void every non-voided
     *  member of a multi-unit split checkout in ONE transaction. A single
     *  void/refund of one member alone is refused (see the guard error). */
    voidCheckoutGroup: (groupId: string) => Promise<{
      success: boolean;
      groupId?: string;
      memberCount?: number;
      voidedTransactionIds?: number[];
      reversalIds?: number[];
      error?: string;
    }>;
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

  // Database path management
  database: {
    isJoinInstallation: () => Promise<{
      success: boolean;
      isJoin: boolean;
      error?: string;
    }>;
    browse: () => Promise<{
      success: boolean;
      canceled?: boolean;
      path?: string;
      error?: string;
    }>;
    changePath: (newPath: string) => Promise<{
      success: boolean;
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
    }) => Promise<{ success: boolean; adminUserId?: number; error?: string }>;
    reset: () => Promise<{ success: boolean; error?: string }>;
    testDatabasePath: (
      path: string,
    ) => Promise<{ success: boolean; error?: string }>;
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
      validity_days?: number | null;
      credits?: number | null;
      /** LIRA-090 (v140) Only-Days split columns — nullable, all optional. */
      days_cost_lbp?: number | null;
      sell_days_lbp?: number | null;
      sell_credit_lbp?: number | null;
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
        validity_days?: number | null;
        credits?: number | null;
        /** LIRA-090 (v140) Only-Days split columns — nullable, all optional. */
        days_cost_lbp?: number | null;
        sell_days_lbp?: number | null;
        sell_credit_lbp?: number | null;
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
        validity_days?: number | null;
        credits?: number | null;
        // TELECOM_DAYS_COST_PLAN.md §4.3 — fresh-install Only-Days split cost.
        days_cost_lbp?: number | null;
        // TELECOM_CREDIT_RATE_PLAN.md — fresh-install days-only sell price.
        sell_days_lbp?: number | null;
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

  // Carrier Lines (LIRA W6.a — shop SIM-line tracking; informational only)
  carrierLines: {
    getActiveByCarrier: (carrier: "alfa" | "mtc") => Promise<{
      success: boolean;
      data?: CarrierLine[];
      error?: string;
    }>;
    getAllActive: () => Promise<{
      success: boolean;
      data?: CarrierLine[];
      error?: string;
    }>;
    getAllAdmin: () => Promise<{
      success: boolean;
      data?: CarrierLine[];
      error?: string;
    }>;
    create: (data: {
      carrier: "alfa" | "mtc";
      phone_number: string;
      label?: string | null;
      credits?: number;
      validity_expires_at?: string | null;
      notes?: string | null;
    }) => Promise<{ success: boolean; data?: CarrierLine; error?: string }>;
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
    ) => Promise<{ success: boolean; data?: CarrierLine; error?: string }>;
    updateBalance: (
      id: number,
      data: { credits?: number; validity_expires_at?: string | null },
    ) => Promise<{ success: boolean; data?: CarrierLine; error?: string }>;
    archive: (
      id: number,
    ) => Promise<{ success: boolean; data?: CarrierLine; error?: string }>;
    toggleActive: (
      id: number,
    ) => Promise<{ success: boolean; data?: CarrierLine; error?: string }>;
    /** LIRA-090: get the current primary line for a carrier (null when none
     *  is configured). Read-only; no role gate. */
    getPrimary: (carrier: "alfa" | "mtc") => Promise<{
      success: boolean;
      data?: CarrierLine | null;
      error?: string;
    }>;
    /** LIRA-090: designate a line as the primary for its carrier (admin only).
     *  Atomically clears the previous holder. */
    setPrimary: (
      id: number,
    ) => Promise<{ success: boolean; data?: CarrierLine; error?: string }>;
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
    printWithDialog: (
      html: string,
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
      category?: string;
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
        voucher_code?: string;
        direction?: "IN" | "OUT";
      }>;
      transaction_time?: string;
      /** Operator-edited USD↔LBP rate of record (rule 12: preload type
       *  completeness) — stamped verbatim onto the transaction by
       *  CustomServiceRepository; omitted falls back to a live snapshot rate. */
      exchange_rate?: number;
      partnerId?: number;
      partnerMode?: "FOR";
      /** FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 (rule 12: preload type
       *  completeness) — set only when the operator picked a product from
       *  the inventory SearchBar; decrements 1 unit of stock. */
      product_id?: number;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
    updateMetadata: (data: {
      id: number;
      description?: string;
      client_name?: string;
      phone_number?: string;
      note?: string;
      category?: string;
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };

  // Hold Money (cash held on behalf of a client)
  holdMoney: {
    list: (filter?: { status?: "held" | "collected" }) => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        client_name: string;
        phone_number: string | null;
        usd_amount: number;
        lbp_amount: number;
        status: "held" | "collected";
        notes: string | null;
        created_by: number | null;
        collected_by: number | null;
        collected_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      error?: string;
    }>;
    active: () => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        client_name: string;
        phone_number: string | null;
        usd_amount: number;
        lbp_amount: number;
        status: "held" | "collected";
        notes: string | null;
        created_by: number | null;
        collected_by: number | null;
        collected_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
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

  // Service Presets
  servicePresets: {
    list: (filter?: {
      category?: string;
      includeInactive?: boolean;
    }) => Promise<{
      success: boolean;
      data?: Array<{
        id: number;
        name: string;
        category: string;
        cost_usd: number;
        cost_lbp: number;
        price_usd: number;
        price_lbp: number;
        is_active: number;
        sort_order: number;
        created_at: string;
        updated_at: string;
      }>;
      error?: string;
    }>;
    create: (data: {
      name: string;
      category: string;
      cost_usd?: number;
      cost_lbp?: number;
      price_usd?: number;
      price_lbp?: number;
      is_active?: number;
      sort_order?: number;
    }) => Promise<{
      success: boolean;
      data?: {
        id: number;
        name: string;
        category: string;
        cost_usd: number;
        cost_lbp: number;
        price_usd: number;
        price_lbp: number;
        is_active: number;
        sort_order: number;
        created_at: string;
        updated_at: string;
      };
      error?: string;
    }>;
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
    ) => Promise<{
      success: boolean;
      data?: {
        id: number;
        name: string;
        category: string;
        cost_usd: number;
        cost_lbp: number;
        price_usd: number;
        price_lbp: number;
        is_active: number;
        sort_order: number;
        created_at: string;
        updated_at: string;
      };
      error?: string;
    }>;
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

  // Partners
  partners: {
    getAll: (includeInactive?: boolean) => Promise<Partner[]>;
    getById: (id: number) => Promise<Partner>;
    create: (data: {
      name: string;
      phone?: string;
      notes?: string;
      system_association?: string | null;
    }) => Promise<{ success: boolean; data?: Partner; error?: string }>;
    update: (
      id: number,
      data: {
        name?: string;
        phone?: string;
        notes?: string;
        system_association?: string | null;
      },
    ) => Promise<{ success: boolean; data?: Partner; error?: string }>;
    deactivate: (id: number) => Promise<{ success: boolean; error?: string }>;
    activate: (id: number) => Promise<{ success: boolean; error?: string }>;
    getBalance: (partnerId: number) => Promise<PartnerBalance>;
    getAllBalances: (
      includeInactive?: boolean,
    ) => Promise<PartnerWithBalance[]>;
    getLedger: (
      partnerId: number,
      filters?: LedgerFilters,
    ) => Promise<{
      partner: Partner;
      balance: PartnerBalance;
      breakdown: PartnerBalanceBreakdown;
      entries: PartnerLedgerEntry[];
    }>;
    recordTransaction: (data: {
      partnerId: number;
      transactionType: string;
      referenceTable?: string;
      referenceId?: number;
      amount: number;
      currency: string;
      direction: "DEBIT" | "CREDIT";
      notes?: string;
    }) => Promise<{
      success: boolean;
      data?: PartnerLedgerEntry;
      error?: string;
    }>;
    settle: (data: {
      partnerId: number;
      amount: number;
      currency: string;
      settlementMethod: string;
      notes?: string;
      /** CQ-10: bundled discount — forgives part of what the partner owes
       *  alongside the settlement. Posts a signed-profit 'DISCOUNT' row. */
      discount?: { amount_usd: number; amount_lbp: number; reason?: string };
      /** CQ-11 — split-leg settlement (MultiPaymentInput), e.g. $60 CASH +
       *  $40 OMT. Every leg's currency_code must match `currency` above and
       *  legs must sum to `amount` (±0.005); when present it supersedes
       *  `settlementMethod` for money movement (still required — stamped on
       *  the partner_ledger row; CHECK-constrained, so it must be a real
       *  method, never "SPLIT"). CLIENT_ACCOUNT settles no money and can
       *  never appear as a leg. */
      payments?: Array<{
        method: string;
        currency_code: string;
        amount: number;
      }>;
    }) => Promise<{
      success: boolean;
      data?: PartnerLedgerEntry;
      error?: string;
    }>;
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

  // Service Providers (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phases 4a + 5)
  serviceProviders: {
    list: () => Promise<ServiceProviderEntity[]>;
    listActive: () => Promise<ServiceProviderEntity[]>;
    create: (data: {
      code: string;
      label: string;
    }) => Promise<{ success: boolean; id?: number; error?: string }>;
    update: (
      id: number,
      data: { label?: string; is_active?: number },
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (id: number) => Promise<{ success: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

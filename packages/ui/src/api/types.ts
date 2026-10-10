// =============================================================================
// Core Types (from @liratek/core repositories)
//
// ClientEntity is re-exported from ../types (sourced from @liratek/core).
// All other entity types used only by the adapter are declared here.
// =============================================================================

// LIRA-263 — maintenance save payload derived from the core schema (rule 21).
import type { SaveMaintenanceJobPayload } from "@liratek/core";
import type {
  ClientEntity,
  // LIRA-185 #1 — recharge payload derived from the core schema (rule 21).
  CreateRechargePayload,
  // Exchange submit payload (incl. payout kept change), derived from the
  // core schema (rule 21).
  ExchangeSubmitPayload,
  // Debts credit cash-out payload (incl. payout kept change), derived from
  // the core schema (rule 21).
  DebtCashOutPayload,
  ProductListFilters,
  DatabaseResetPreview,
  DatabaseResetResult,
  SafeSession,
  AddRepaymentInput,
  CreateUserInput,
  SupplierAccountLinkInput,
  TopUpFromClientInput,
  CommissionsReport,
  CommissionProviderRow,
  // LIRA-219 (C.2/C.4) — the pinned closing-profit-parity contract, imported
  // directly rather than hand-copied (rule 21). `@liratek/core` resolves to
  // `browser.ts` for this package's build, which re-exports both type-only
  // (rule 29).
  DailyStatsSnapshot,
  DailyStatsSnapshotQuery,
  // CHART-m5 (verifier finding, round 1 of the DC-10..12 fix pass) — the
  // "Net Profit — last 30 days" tile shape, imported directly rather than
  // hand-copied a second time here (rule 21).
  NetProfitWindowResult,
  // PFU-types-1 (verifier round-1 fix) — the Profits Overview/By Module
  // shapes, imported directly (rule 21) instead of the `Promise<any>` this
  // adapter previously declared, which let the two transports and this
  // interface disagree silently.
  ProfitSummary,
  ProfitByModule,
  // PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — the By
  // Module drill-down's "Show transactions" payload, imported directly (rule
  // 21), same reasoning as ProfitSummary/ProfitByModule above.
  ProfitModuleDetail,
  // LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration v183) — Hold
  // Money's create/collect payloads, imported directly (rule 21) instead of
  // a hand-typed object literal that could silently drift from the schema.
  HoldMoneyCreateInput,
  HoldMoneyCollectPayload,
  // LIRA-231 — POS "Refund Sale"/"Refund item" refund-leg-override payloads,
  // imported directly (rule 21) instead of a hand-typed object literal.
  SaleRefundPayload,
  SaleRefundItemPayload,
  // LIRA-147 — admin "Undo refund" payload, imported directly (rule 21).
  SaleUndoItemRefundInput,
  // LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — session-basket
  // single-item refund payload (rule 21) + result/preview shapes, imported
  // directly instead of a hand-typed object literal.
  SessionItemRefundPayload,
  SessionItemRefundPreviewPayload,
  RefundSessionBasketItemResult,
  SessionItemRefundPreview,
  // LIRA-185 — Loto report shape incl. kept change (rule 21).
  LotoReportData,
  // Typing follow-up (rule 21/24) — `refundTransaction` below used to
  // hand-type its `refundLegs`/`unitExtras` params with `currencyCode:
  // string` (loose), instead of importing these directly the way
  // `SaleRefundInput` above already does; imported directly now instead.
  RefundLegInput,
  RefundUnitExtraInput,
  // Owner decision 2026-10-07 — refund kept change (rule 21).
  RefundKeptChangeInput,
  // LIRA-252 wave 2 — carrier-line manual-drawer-adjustment read shape,
  // imported directly (rule 21) instead of a hand-typed object literal.
  CarrierLineAdjustmentRecord,
  CarrierLineAdjustmentFilters,
  // LIRA-258 — loto sell/settle payloads derived from the core schemas
  // (rule 21).
  LotoSellPayload,
  CreateCustomServicePayload,
  LotoCheckpointSettlePayload,
  LotoCheckpointsSettleBatchPayload,
  // LIRA-262 — "shop used its own stock" expense payload (rule 21).
  CreateStockExpenseInput,
  CreateExpenseRequest,
  // Session basket checkout payload, derived from the core schema (rule 21).
  SessionCheckoutPayload,
  // Partner settle payload, derived from partnerSettleSchema (rule 21).
  PartnerSettleInput,
  // Supplier settle payload, derived from supplierSettleSchema (rule 21).
  SupplierSettleInput,
  // LIRA-296 — warranty search payload + row, derived from the core schema.
  WarrantySearchInput,
  WarrantySearchRow,
  UpdateCategoryPayload,
  SalesDateRangeInput,
  CreateWarrantyClaimInput,
  WarrantyClaimsForInput,
  VoidWarrantyClaimInput,
  ListDefectiveItemsInput,
  ResolveDefectiveInput,
  CreateSupplierReturnInput,
  CloseSupplierReturnInput,
  ListSupplierReturnsInput,
  WarrantyReportInput,
  SupplierReturnView,
  WarrantyReport,
  WarrantyClaimResultData,
  WarrantyClaimView,
  DefectiveItemView,
  WarrantyEnvelope,
} from "@liratek/core";

// LIRA-297 — write payloads derived from the core schemas (rule 21):
// `z.input<…>` aliases computed inside core, never hand-copied literals.
import type {
  SaleProcessPayload,
  SaleUpdateMetadataPayload,
  DebtAccountEntryPayload,
  DebtUseCreditPayload,
  DebtUpdateMetadataPayload,
  DebtWriteOffPayload,
  AddRepaymentPayload,
  ExpenseUpdateMetadataPayload,
  FinancialUpdateMetadataPayload,
  PartnerCreatePayload,
  PartnerRecordTransactionPayload,
  PartnerUpdatePayload,
  PartnerWriteOffPayload,
  RechargeCashoutPayload,
  SelfChargeTelecomItemPayload,
  TopUpAppPayload,
  TopUpFromPartnerPayload,
  TopUpFromSupplierPayload,
  UpdateExchangeMetadataPayload,
  UpdateRechargeMetadataPayload,
  VoucherCreatePayload,
  CreateFinancialServicePayload,
  AdjustLotPositionPayload,
  CarrierLineCreatePayload,
  CarrierLineUpdateBalancePayload,
  CarrierLineUpdatePayload,
  CreateCheckpointPayload,
  CreateDrawerCashoutPayload,
  CreateDrawerTransferPayload,
  CreateServiceProviderPayload,
  CreateWalletExchangePayload,
  CustomServiceUpdateMetadataPayload,
  DatabaseResetPayload,
  LotoCashPrizePayload,
  LotoCheckpointCreatePayload,
  LotoCheckpointUpdatePayload,
  LotoFeePayload,
  LotoTicketUpdatePayload,
  LotoUpdateMetadataPayload,
  MobileServiceItemCreatePayload,
  MobileServiceItemUpdatePayload,
  PreviewLotSettlementPayload,
  ReceiveStockPayload,
  RegisterProductUnitsPayload,
  ServicePresetCreatePayload,
  ServicePresetUpdatePayload,
  SetRatePayload,
  SupplierCashflowPayload,
  SupplierLedgerEntryPayload,
  SupplierPurchaseCreatePayload,
  SupplierRecordDebtPayload,
  SupplierSettleAccountPayload,
  UpdateCustomServiceFulfillmentPayload,
  UpdateCustomServiceWorkStatusPayload,
  UpdateServiceProviderPayload,
  CreateClientPayload,
  RecordCarrierLineUsagePayload,
  StockAdjustPayload,
  BatchUpdateProductsPayload,
  ImportClientDebtsPayload,
} from "@liratek/core";

// Re-export so api consumers don't need a separate import
export type {
  ClientEntity,
  ProductListFilters,
  DatabaseResetPreview,
  DatabaseResetResult,
  SafeSession,
  AddRepaymentInput,
  CreateUserInput,
  SupplierAccountLinkInput,
  TopUpFromClientInput,
  CommissionsReport,
  CommissionProviderRow,
  DailyStatsSnapshot,
  DailyStatsSnapshotQuery,
  NetProfitWindowResult,
};

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

/**
 * LIRA-143 — one row of the Phone Units management view: the unit's own
 * columns, its product model's name, the provenance of the sale it was last
 * sold on, and the computed warranty verdict. Every sale-side field is
 * `null` for a unit that has never been sold, `sale_refunded` included
 * (which is what keeps "never sold" distinct from `0` = "sold, not
 * refunded").
 */
export type ProductUnitListRow = {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  is_defective: number;
  warranty_override_until: string | null;
  created_at: string;
  product_name: string;
  /** `products.is_deleted` off the same join as `product_name` — `null` when
   *  the product row is missing, `1` when soft-deleted, `0` when live. Only a
   *  truthy `1` means deleted (LIRA-152). */
  product_deleted: number | null;
  /** The owning MODEL's warranty term (`products.warranty_months`) —
   *  display-only, so unsold stock can show "N mo — starts at sale" instead
   *  of "No warranty". Never a coverage claim (decision #4: the clock starts
   *  at the sale). */
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
};

/** One page of {@link ProductUnitListRow}s plus the UNPAGED total over the
 *  same filters — the pager's denominator, not `rows.length`. */
export type ProductUnitListResult = {
  rows: ProductUnitListRow[];
  total: number;
};

/** Filter/page payload for the Phone Units management view. `limit`/`offset`
 *  may be omitted — the shared Zod schema applies 50/0 on both transports. */
export type ProductUnitListFilters = {
  status?: "IN_STOCK" | "SOLD";
  defectiveOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
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
  /** Migration v165 (owner-reported 2026-09-07): null for every row except
   *  a real delivery (`ProductRepository.receiveStock`) — no cost applies
   *  to a plain increase/decrease/set-absolute correction, and a pre-v165
   *  row never recorded one. Mirrors `StockAdjustmentEntity`
   *  (packages/core/src/repositories/StockAdjustmentRepository.ts)
   *  field-for-field; hand-kept in sync (same convention as `StockBatchRow`
   *  below) rather than imported. */
  unit_cost_usd: number | null;
  username: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * One status transition on a maintenance job's history timeline. Mirrors
 * `MaintenanceStatusHistoryRow`
 * (packages/core/src/repositories/MaintenanceRepository.ts) field-for-field;
 * hand-kept in sync (same convention as `StockAdjustmentEntity` above)
 * rather than imported, since `@liratek/core` resolves to browser.ts for
 * Vite and frontend jest and this entity isn't exported there. (Note:
 * `StockBatchRow` is NOT a precedent for this — it's declared locally in
 * `frontend/src/api/backendApi.ts` and never re-exported from `@liratek/ui`
 * at all.) Must be listed in this file's barrel (`./index.ts`'s
 * `export type { ... }` allowlist) to actually be visible to consumers —
 * `ApiAdapter` below references it in its own signature, so it has to be
 * public.
 */
export type MaintenanceStatusHistoryRow = {
  id: number;
  maintenance_id: number;
  from_status: string | null;
  to_status: string;
  changed_by: number | null;
  note: string | null;
  created_at: string;
};

/**
 * One row of a product's remaining cost batches — a product can hold stock
 * bought at several different prices (owner report 2026-09-07: 2 iPhones
 * received at $1,300 on top of 2 already held at $1,200, with no way to see
 * the split). Mirrors `StockBatchEntity`
 * (packages/core/src/repositories/StockBatchRepository.ts) field-for-field;
 * hand-kept in sync (same convention as `StockAdjustmentEntity` above)
 * rather than imported, since `@liratek/core` resolves to browser.ts for
 * Vite and frontend jest and this entity isn't exported there.
 */
export type StockBatchRow = {
  id: number;
  tenant_id: number;
  product_id: number;
  supplier_id: number | null;
  quantity: number;
  quantity_remaining: number;
  unit_cost_usd: number;
  books_debt: number;
  ledger_entry_id: number | null;
  transaction_id: number | null;
  is_opening: number;
  created_by: number | null;
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
  /** LIRA-131: now projected by DebtRepository.getColumns(). */
  is_refunded?: number;
  refunded_at?: string | null;
  /** LIRA-241 — display name of the user who recorded this ledger entry
   *  (`created_by` joined to `users.username`), for the Debts page's User
   *  column. Null/absent when `created_by` is null (system-authored row) or
   *  the user was deleted — render as "—". */
  created_by_username?: string | null;
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

// LIRA-219 (C.2) — `DailyStatsSnapshot`/`DailyStatsSnapshotQuery` are now
// imported directly from `@liratek/core` (see the import block above) rather
// than hand-copied here; the old local duplicate is gone (rule 21).

/**
 * LIRA-159 D2: per-provider unsettled commission rollup
 * (`FinancialServiceRepository.getUnsettledSummaryByProvider`).
 *
 * `pending_commission_usd`/`_lbp` are LEGACY-model-only (`commission_model =
 * 0`) — 0 for providers whose unsettled rows are all post-cutover
 * (`commission_model = 1`). For those, `awaiting_settlement_count` is the
 * only honest figure: a model-1 row's commission is unknowable until the
 * operator enters it at settlement (owner decision D15), so it must render
 * as a transaction count, never as a dollar amount.
 */
export type UnsettledSummary = {
  provider: string;
  count: number;
  bill_count: number;
  pending_commission_usd: number;
  pending_commission_lbp: number;
  total_owed_usd: number;
  total_owed_lbp: number;
  awaiting_settlement_count: number;
};

/**
 * OMT open-credit account (LIRA-187/188) — `'OMT'` is the account parent;
 * `'OMT App'` and `'iPick'` are children linked via
 * `suppliers.account_supplier_id`. Ledger rows never move (plan §2); this is
 * a read-time rollup. Mirrors `@liratek/core`'s `AccountBalance`
 * (`SupplierRepository.ts`) verbatim (rule 14) — not imported directly
 * because this file is bundled by Vite/frontend jest, which resolve
 * `@liratek/core` to its browser-only entrypoint.
 */
export type AccountBalance = {
  account_supplier_id: number;
  account_name: string;
  /** Parent + children, summed. */
  total_usd: number;
  total_lbp: number;
  children: AccountChildBalance[];
};

/** @see AccountBalance */
export type AccountChildBalance = {
  supplier_id: number;
  name: string;
  provider: string | null;
  /** From `service_providers.drawer_name`; null if unknown. */
  drawer_name: string | null;
  total_usd: number;
  total_lbp: number;
  /** true for the OMT counter row itself (the account parent). */
  is_parent: boolean;
};

/**
 * One row of the OMT account's unioned ledger (parent + every child),
 * newest first. `source_name` is the Suppliers page's Type column value.
 * Mirrors `@liratek/core`'s `AccountLedgerEntry` verbatim (rule 14).
 */
export type AccountLedgerEntry = {
  id: number;
  supplier_id: number;
  /** 'OMT' | 'OMT_APP' | 'iPick' */
  source_provider: string | null;
  /** 'OMT' | 'OMT App' | 'iPick' — the Type column. */
  source_name: string;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  is_refunded: number;
  settlement_id: number | null;
};

/**
 * One row of the OMT account's unsettled queue — a union of two
 * structurally different sources (plan §9.3): pending `financial_services`
 * rows (kind FINANCIAL_SERVICE) and raw `supplier_ledger` rows with
 * `settlement_id IS NULL` (kind LEDGER). Mirrors `@liratek/core`'s
 * `AccountUnsettledRow` verbatim (rule 14).
 */
export type AccountUnsettledRow = {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  supplier_id: number;
  source_provider: string | null;
  /** The Type column. */
  source_name: string;
  created_at: string;
  amount_usd: number;
  amount_lbp: number;
  /** Set for LEDGER rows. */
  entry_type: string | null;
  /** Set for FINANCIAL_SERVICE rows. */
  service_type: string | null;
  /**
   * Deferred cashout commission this row contributes to `settleAccount`'s
   * recognised profit (D14, §8.3a) — always 0 except a WALLET_CASHOUT
   * LEDGER row, never `undefined`. Mirrors `@liratek/core`'s
   * `AccountUnsettledRow` verbatim (rule 14) — see its doc comment for the
   * shared-predicate guarantee that this can never disagree with what
   * settlement actually stamps.
   */
  commission_usd: number;
  commission_lbp: number;
};

/**
 * LIRA-255 — "check against OMT's statement" panel. Mirrors `@liratek/core`'s
 * `AccountExpectedStatement` (`SupplierRepository.ts`) verbatim (rule 14) —
 * not imported directly for the same browser-entrypoint reason the three
 * types above aren't.
 */
export type AccountExpectedStatement = {
  account_supplier_id: number;
  /** = {@link AccountBalance.total_usd}/`total_lbp` for this account. */
  gross_owed_usd: number;
  gross_owed_lbp: number;
  /** Sum of `commission` across every pending-settlement financial_services
   *  row for this account's members, ALL commission types/models. */
  unsettled_commission_usd: number;
  unsettled_commission_lbp: number;
  /** gross_owed − unsettled_commission, in OMT's own sign convention
   *  (minus = OMT owes the shop, plus = the shop owes OMT). */
  expected_usd: number;
  expected_lbp: number;
};

/**
 * LIRA-163: per-currency slice of `getOMTAnalytics`'s `today`/`month`
 * buckets, mirroring `FinancialServiceRepository.CurrencyStats`.
 * `awaiting_settlement_count` is optional so an older cached payload (or a
 * test mock built before this field existed) still type-checks.
 */
export type OMTCurrencyStats = {
  currency: string;
  commission: number;
  count: number;
  awaiting_settlement_count?: number;
};

/**
 * LIRA-163: per-provider+currency row, mirroring
 * `FinancialServiceRepository.ProviderStats`.
 */
export type OMTProviderStats = {
  provider: string;
  commission: number;
  currency: string;
  count: number;
  awaiting_settlement_count?: number;
};

/**
 * Return shape of `getOMTAnalytics` (`FinancialService.getAnalytics` over
 * BOTH transports — IPC `omt:get-analytics` and REST
 * `GET /api/services/analytics`), mirroring
 * `FinancialServiceRepository.FinancialServiceAnalytics`. Was `Promise<any>`
 * (rule: no `any`) — fixed while wiring `awaiting_settlement_count` (LIRA-163)
 * through this adapter, since every consumer of this call needed a real
 * shape to read that field off of anyway.
 */
export type OMTAnalytics = {
  today: {
    commission: number;
    pending_commission: number;
    count: number;
    awaiting_settlement_count?: number;
    byCurrency: OMTCurrencyStats[];
  };
  month: {
    commission: number;
    pending_commission: number;
    count: number;
    awaiting_settlement_count?: number;
    byCurrency: OMTCurrencyStats[];
  };
  byProvider: OMTProviderStats[];
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

/** LIRA-149 — mirrors `InventoryService.batchDeleteProducts`'s return shape,
 *  identical on both transports (IPC raw; REST envelope-parity 200). */
export type BatchDeleteProductsResult = {
  success: boolean;
  deleted?: number;
  removed_unit_count?: number;
  removed_unit_imeis?: string[];
  error?: string;
};

export type ProcessSaleResult = {
  success: boolean;
  id?: number;
  error?: string;
  /** LIRA-296 P3: `SERIAL_REQUIRED` when a BLOCK category refused it. */
  code?: string;
  /** LIRA-296 P3: notes for the cashier on a sale that went through. */
  warnings?: string[];
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

/**
 * A `service_providers` config row (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md
 * §5b phase 4a) — powers the Partners "System Association" dropdown with
 * the real, tenant-scoped provider list instead of a hardcoded pair.
 */
export type ServiceProviderEntity = {
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
};

/** LIRA W6.a — a shop-owned alfa/mtc SIM line. Informational only. */
export type CarrierLineEntity = {
  id: number;
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  /** v184 (#28) — sold-ahead balance: days a DAYS sale promised the customer
   *  that the line's real remaining days couldn't cover at sale time. */
  days_owed: number;
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

/** v184 (#28, LIRA-218) — one "days still to send" list entry: a DAYS sale
 *  that sold ahead of the line's real remaining days. */
export type CarrierLineOwedDeliveryEntity = {
  id: number;
  carrier_line_id: number;
  transaction_id: number | null;
  client_id: number | null;
  client_name: string | null;
  days_owed: number;
  status: "PENDING" | "SENT";
  sent_at: string | null;
  sent_by: number | null;
  created_at: string;
  updated_at: string;
};

export type CarrierLineOwedDeliveryListResult = {
  success: boolean;
  data?: CarrierLineOwedDeliveryEntity[];
  error?: string;
};

export type MarkCarrierLineOwedDeliverySentResult = {
  success: boolean;
  data?: CarrierLineOwedDeliveryEntity;
  error?: string;
};

/** LIRA-145 — payload for `recordCarrierLineUsage`. Runtime twin of core's
 *  `recordCarrierLineUsageSchema` (validators/carrierLine.ts). */
/** LIRA-145 payload, derived from `recordCarrierLineUsageSchema` (rule 21). */
export type CarrierLineUsagePayload = RecordCarrierLineUsagePayload;

/** LIRA-145 — envelope returned by `recordCarrierLineUsage`. */
export type CarrierLineUsageResult = {
  success: boolean;
  data?: {
    expenseId: number;
    /** The unified EXPENSE `transactions` row; the `carrier_line_movements`
     *  row hangs off it, which is what makes a void restore the line. */
    transactionId: number;
    /** BOOKED expense magnitude in USD (round2 of the raw delta). */
    creditsUsed: number;
    newCredits: number;
  };
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
  /** v160: per-card override of the returnable credit maximum; null = computed. */
  max_returned_credits_usd: number | null;
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
    data: LotoCheckpointCreatePayload,
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
    data: LotoCheckpointUpdatePayload,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  markSettled: (
    id: number,
    settledAt?: string,
    settlementId?: number,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  settle: (
    data: LotoCheckpointSettlePayload,
  ) => Promise<{ success: boolean; checkpoint?: any; error?: string }>;
  settleBatch: (
    data: LotoCheckpointsSettleBatchPayload,
  ) => Promise<{ success: boolean; checkpoints?: any[]; error?: string }>;
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
    data: LotoCashPrizePayload,
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
    data: LotoFeePayload,
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
    data: LotoSellPayload,
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
    data: LotoTicketUpdatePayload,
  ) => Promise<{ success: boolean; ticket?: any; error?: string }>;
  /** Edits a loto TICKET's note (loto_tickets) — NOT a checkpoint's;
   *  see lotoUpdateMetadata in backendApi.ts. No UI caller currently. */
  updateMetadata: (
    data: LotoUpdateMetadataPayload,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  report: (
    from: string,
    to: string,
  ) => Promise<{
    success: boolean;
    reportData?: LotoReportData;
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
  /**
   * "Signed-in devices" (SESSION_RESILIENCE_AND_DEVICES_PLAN.md Part 2 step
   * 4) — the caller's OWN active sessions, `is_current` flagged
   * server-side. `SafeSession` never carries the bearer token (see its own
   * doc comment) — leaking it would hand any XSS a ready-made session to
   * replay.
   *
   * Named `listUserSessions` (matching `AuthService.listUserSessions`), NOT
   * `listSessions` — that name is already taken by the unrelated Customer
   * Sessions (POS basket) list further down this interface
   * (`listSessions: (limit?, offset?) => Promise<any>`); reusing it would be
   * a duplicate property, not a namespace clash a caller could resolve.
   */
  listUserSessions: () => Promise<SafeSession[]>;
  /**
   * Revoke one of the caller's own sessions by `id` — never by token,
   * since the client has no token to send for a session that isn't its
   * own current one. Refused server-side for an id belonging to another
   * user or another tenant.
   */
  revokeSession: (id: number) => Promise<{ success: boolean; error?: string }>;
  /**
   * "Sign out everywhere else" — revokes every OTHER active session for
   * the caller, leaving the current one (and the caller's own login)
   * intact.
   */
  revokeOtherSessions: () => Promise<{
    success: boolean;
    data?: { revoked: number };
    error?: string;
  }>;

  // ---------------------------------------------------------------------------
  // Clients
  // ---------------------------------------------------------------------------
  getClients: (search?: string) => Promise<ClientEntity[]>;
  createClient: (
    payload: CreateClientPayload,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  deleteClient: (id: number) => Promise<ApiResult>;
  /**
   * Bulk import of clients and their debt history from a parsed Excel sheet.
   * Admin only, on both transports. Returns the per-category counts the import
   * summary dialog reads.
   */
  importClientDebts: (clients: ImportClientDebtsPayload["clients"]) => Promise<{
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

  // ---------------------------------------------------------------------------
  // Inventory / Products
  // ---------------------------------------------------------------------------
  /** `filters` is applied server-side (SQL), so the returned array is already
   *  the filtered set — callers must not re-filter it client-side. */
  getProducts: (
    search?: string,
    filters?: ProductListFilters,
  ) => Promise<any[]>;
  /** Distinct category / supplier values across the tenant's products —
   *  the option lists for the inventory filter dropdowns. */
  getProductFilterOptions: () => Promise<{
    categories: string[];
    suppliers: string[];
  }>;
  /** The curated `product_suppliers` list — includes suppliers with no
   *  products yet, unlike `getProductFilterOptions().suppliers`. Backs the
   *  ProductForm supplier datalist. */
  getProductSuppliers: () => Promise<string[]>;
  /** LIRA-143 Phase 5 — Settings manager: id/name/sort_order/is_active/
   *  product_count rows, distinct from the plain-names `getProductSuppliers`
   *  above. */
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
  createProduct: (payload: any) => Promise<ProductWriteResult>;
  updateProduct: (id: number, payload: any) => Promise<ProductWriteResult>;
  deleteProduct: (id: number) => Promise<ProductWriteResult>;
  /** LIRA-149 — dual-transport twin of the inventory grid's multi-select
   *  delete (IPC `inventory:batch-delete` / REST
   *  `POST /api/inventory/products/batch-delete`). */
  batchDeleteProducts: (ids: number[]) => Promise<BatchDeleteProductsResult>;
  /** Inventory grid's multi-select edit (category / min-stock-threshold /
   *  supplier / unit for many products in one call). `unit`
   *  (`products.unit`, a nullable TEXT column) is wired end-to-end on both
   *  transports, the same as `supplier` — see `batchUpdateProductsSchema`
   *  (packages/core/src/validators/product.ts). */
  batchUpdateProducts: (
    payload: BatchUpdateProductsPayload,
  ) => Promise<{ success: boolean; updated: number; error?: string }>;
  getLowStockProducts: () => Promise<any[]>;
  /** Look up a product by its exact barcode (null when no match) — the
   *  ProductForm barcode generator's uniqueness check. */
  getProductByBarcode: (barcode: string) => Promise<any | null>;
  /** LIRA-225 — single-row product read by id (null when missing). The
   *  Adjust Stock hand-off from the product edit form uses this instead of
   *  searching `ProductList`'s current (filtered/searched) `products` array,
   *  which can dead-end on a product the active filters hide. */
  getProductById: (id: number) => Promise<any | null>;
  /** Plain category NAMES, distinct from `getCategoriesFull` below (which
   *  carries id/sort_order/tracks_imei_units). */
  getCategories: () => Promise<string[]>;
  /** Supplier stock-intake: receives stock into a product, optionally
   *  against a supplier (writes a product_stock_batches row and, unless
   *  `is_old_stock` or there's no supplier, a supplier_ledger
   *  'STOCK_INTAKE' row — see InventoryService.receiveStock). `userId` is
   *  injected server-side by both transports, never sent by the client. */
  receiveStock: (
    payload: ReceiveStockPayload,
  ) => Promise<{ success: boolean; error?: string; batch_id?: number }>;
  /** LIRA-077: set-absolute (newQuantity) or delta stock correction, always
   *  with a reason for the stock_adjustments audit trail. */
  adjustStock: (
    payload: StockAdjustPayload,
  ) => Promise<{ success: boolean; error?: string }>;
  /** LIRA-077: adjustment history — one product, or the most recent across
   *  all products when productId is omitted. */
  getStockAdjustments: (productId?: number) => Promise<StockAdjustmentEntity[]>;
  /** A product's remaining cost batches, FIFO/oldest-first — "where are my
   *  other units and what did each one cost" (owner report 2026-09-07). */
  getOpenStockBatches: (productId: number) => Promise<StockBatchRow[]>;
  /** LIRA-143 Phase 3 (owner decision #2): barcode first, then an active
   *  (IN_STOCK) unit IMEI. `matched_unit` is null on a barcode hit. */
  resolveScanCode: (code: string) => Promise<{
    success: boolean;
    data?: { product: any; matched_unit: any | null } | null;
    error?: string;
  }>;

  /** LIRA-296 — warranty lookup for any item (by customer, phone, receipt
   *  number, product or serial). Read: returns the raw row array; a refusal
   *  throws. */
  searchWarranties: (
    input: WarrantySearchInput,
  ) => Promise<WarrantySearchRow[]>;
  /** LIRA-296 P2 — claims and the defective holding. Writes answer the
   *  envelope (a refusal carries its `code`); reads return the raw array. */
  createWarrantyClaim: (
    input: CreateWarrantyClaimInput,
  ) => Promise<WarrantyEnvelope<WarrantyClaimResultData>>;
  getWarrantyClaims: (
    input: WarrantyClaimsForInput,
  ) => Promise<WarrantyClaimView[]>;
  voidWarrantyClaim: (
    input: VoidWarrantyClaimInput,
  ) => Promise<WarrantyEnvelope<WarrantyClaimView>>;
  listDefectiveItems: (
    input?: ListDefectiveItemsInput,
  ) => Promise<DefectiveItemView[]>;
  resolveDefectiveItem: (
    input: ResolveDefectiveInput,
  ) => Promise<WarrantyEnvelope<DefectiveItemView>>;
  /** LIRA-296 P3 — supplier returns (admin). Writes answer the envelope;
   *  the list returns the raw array. */
  createSupplierReturn: (
    input: CreateSupplierReturnInput,
  ) => Promise<WarrantyEnvelope<SupplierReturnView>>;
  closeSupplierReturn: (
    input: CloseSupplierReturnInput,
  ) => Promise<WarrantyEnvelope<SupplierReturnView>>;
  listSupplierReturns: (
    input?: ListSupplierReturnsInput,
  ) => Promise<SupplierReturnView[]>;
  /** LIRA-296 P3 — the warranty report (admin). Read: throws on a refusal. */
  getWarrantyReport: (input: WarrantyReportInput) => Promise<WarrantyReport>;

  /** LIRA-143 Phase 5 — Settings manager (decision #9's tracks_imei_units
   *  toggle). Reads return the raw array. */
  getCategoriesFull: () => Promise<
    Array<{
      id: number;
      name: string;
      sort_order: number;
      is_active: number;
      tracks_imei_units: number;
      /** LIRA-296: default warranty in months; null = none. */
      warranty_months: number | null;
      /** LIRA-296 P3 (v207): the serial name and the sale-without-unit rule. */
      serial_label?: "IMEI" | "Serial";
      serial_required?: "BLOCK" | "WARN";
    }>
  >;
  createCategory: (
    name: string,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  /** Payload derived from core's updateCategorySchema (rule 21). */
  updateCategory: (
    id: number,
    data: UpdateCategoryPayload,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteCategory: (
    id: number,
  ) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;

  // ---------------------------------------------------------------------------
  // Sales
  // ---------------------------------------------------------------------------
  getDrafts: () => Promise<any[]>;
  deleteDraft: (
    saleId: number,
  ) => Promise<{ success: boolean; error?: string }>;
  processSale: (payload: SaleProcessPayload) => Promise<ProcessSaleResult>;
  /** LIRA-296 SF-2 — completed/refunded sales between two shop days
   *  (inclusive). Read: the raw row array; a refusal throws. */
  getSalesByDateRange: (
    range: SalesDateRangeInput,
  ) => Promise<Array<Record<string, unknown> & { id: number }>>;
  getSale: (saleId: number) => Promise<any>;
  getSaleItems: (saleId: number) => Promise<any[]>;
  /** Refund a WHOLE sale (admin only). LIRA-231: `refundLegs` is optional —
   *  omit for the default (mirror the original payment legs verbatim)
   *  reversal; pass the operator's chosen return method(s) to override it.
   *  A session-paid sale is refused server-side. 2026-09-26: `unitExtras` is
   *  optional too — the POS "Returned phones" per-unit defective/warranty-
   *  override flags. LIRA-236: `exchangeRate` is optional too — the rate the
   *  popup was showing at confirm time, meaningful only alongside
   *  `refundLegs` (server validates the override's TOTAL VALUE at that rate
   *  instead of the old per-currency rule). */
  refundSale: (
    saleId: number,
    refundLegs?: SaleRefundPayload["refundLegs"],
    unitExtras?: SaleRefundPayload["unitExtras"],
    exchangeRate?: number,
    /** Owner decision 2026-10-07 — refund kept change. */
    keptChange?: SaleRefundPayload["keptChange"],
  ) => Promise<{ success: boolean; refundId?: number; error?: string }>;
  /** Refund a specific line item off a sale, by quantity (admin only).
   *  LIRA-231: same optional `refundLegs` override, validated against THIS
   *  ITEM's proportional share of the sale. 2026-09-26: `unitExtras` — same
   *  as `refundSale` above, validated against THIS ITEM's own linked
   *  unit(s) only. LIRA-236: `exchangeRate` — same as `refundSale` above. */
  refundSaleItem: (
    saleId: number,
    saleItemId: number,
    refundQuantity: number,
    refundLegs?: SaleRefundItemPayload["refundLegs"],
    unitExtras?: SaleRefundItemPayload["unitExtras"],
    exchangeRate?: number,
    /** Owner decision 2026-10-07 — refund kept change. */
    keptChange?: SaleRefundItemPayload["keptChange"],
  ) => Promise<{ success: boolean; refundId?: number; error?: string }>;
  /** LIRA-147 — admin-only "Undo refund" for a standalone per-item refund.
   *  `refundTransactionId` is the REFUND row's own transaction id —
   *  everything else the undo needs is read back server-side from that
   *  row's own metadata. */
  undoItemRefund: (
    refundTransactionId: SaleUndoItemRefundInput["refundTransactionId"],
  ) => Promise<{ success: boolean; undoId?: number; error?: string }>;
  /**
   * LIRA-231 — POS refund preview (both refund buttons): the sale's (or,
   * with `item`, one item's proportional share of the sale's) own
   * customer-facing payment legs, for the refund modal's pre-fill, plus
   * whether the sale is session-linked (both POS refund buttons are
   * blocked server-side for a session-paid sale).
   *
   * LIRA-232 round-2 review (finding 1) — `sessionId`/`sessionTransactionId`
   * (present when `sessionLinked`) are the basket + the unified SALE member,
   * so a caller can drive `refundSessionBasketItem` without a separate
   * lookup that resolves the member by "newest row for this source" (breaks
   * after the first item refund — see SaleDetailModal.tsx).
   *
   * LIRA-236 — `bookedRate`/`bookedRateSource` are the popup's default rate
   * (RefundMethodModal's `exchangeRate` prop) + its provenance, feeding the
   * "no rate was recorded" fallback note.
   */
  getSaleRefundPreview: (
    saleId: number,
    item?: { saleItemId: number; refundQuantity: number },
  ) => Promise<{
    success: boolean;
    legs?: Array<{
      direction: "in" | "out";
      amount: number;
      signed_amount: number;
      currency_code: string;
      method: string;
      drawer_name?: string;
    }>;
    sessionLinked?: boolean;
    sessionId?: number;
    sessionTransactionId?: number;
    bookedRate?: number;
    bookedRateSource?: "sale" | "transaction" | "fallback";
    error?: string;
  }>;
  /** Edit non-financial metadata (walk-in name/phone, note) on a sale row. */
  updateSaleMetadata: (
    data: SaleUpdateMetadataPayload,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;

  // ---------------------------------------------------------------------------
  // Debts
  // ---------------------------------------------------------------------------
  getDebtors: () => Promise<DebtorSummary[]>;
  getClientDebtHistory: (clientId: number) => Promise<DebtLedgerEntity[]>;
  getClientDebtTotal: (clientId: number) => Promise<number>;
  /**
   * Payload type is DERIVED from `addRepaymentSchema`
   * (packages/core/src/validators/debt.ts), not hand-copied (rule 14): this
   * signature used to spell every field in snake_case
   * (`client_id`/`amount_usd`/…), which the schema has never accepted — it is
   * camelCase (`clientId`/`amountUSD`/…) and shares that shape across IPC and
   * REST. The Debts page was long ago fixed to send the correct camelCase
   * payload, which meant the hand-written type here silently rejected valid
   * calling code (rule 19 — one payload, both transports). Deriving the type
   * makes that class of drift impossible: if the schema changes, this type
   * changes with it.
   */
  addRepayment: (payload: AddRepaymentPayload) => Promise<ApiResult>;
  /** CQ-10: standalone debt write-off (admin-only) — pure forgiveness, no
   *  cash movement. Capped server-side at the client's outstanding balance
   *  per currency. */
  debtWriteOff: (
    payload: DebtWriteOffPayload,
  ) => Promise<ApiResult & { id?: number }>;
  getClientBalance: (clientId: number) => Promise<{
    success: boolean;
    data?: { balance_usd: number; balance_lbp: number };
    error?: string;
  }>;
  /** Credit cash-out — payload DERIVED from `debtCashOutSchema`'s input
   *  (rule 21), incl. the payout kept change keptChangeUSD/keptChangeLBP. */
  cashOut: (
    payload: DebtCashOutPayload,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  addAccountEntry: (
    payload: DebtAccountEntryPayload,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  /** Consume a client's prepaid credit balance (IPC: debt.useCredit). */
  consumeCredit: (
    payload: DebtUseCreditPayload,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  /** Edit a debt_ledger row's note (IPC: debt.updateMetadata). */
  updateDebtMetadata: (
    payload: DebtUpdateMetadataPayload,
  ) => Promise<{ success: boolean; data?: any; error?: string }>;

  // ---------------------------------------------------------------------------
  // Exchange
  // ---------------------------------------------------------------------------
  getExchangeRates: () => Promise<any[]>;
  getCurrenciesList: () => Promise<any[]>;
  getExchangeHistory: (limit?: number) => Promise<any[]>;
  addExchangeTransaction: (payload: ExchangeSubmitPayload) => Promise<
    ApiResult & {
      id?: number;
      /** The server-authoritative final `transactions.profit_usd` for this
       *  exchange — ALWAYS present on success. The session-link profit
       *  stamp (FEATURE_GUIDE §10/§11) must prefer this over both
       *  `realizedProfitUsd` and the client's own pre-submit total. */
      bookedProfitUsd?: number;
      /** EXCHANGE_LOT_SETTLEMENT.md Phase 3/5 — server-authoritative realized
       *  profit from the FIFO lot engine, present only when the toCurrency
       *  leg consumed lot(s). The frontend MUST prefer this over its own
       *  pre-submit preview when linking into a session
       *  (FEATURE_GUIDE §13 item 9). */
      realizedProfitUsd?: number;
      lotCoveredQty?: number;
      lotMarketQty?: number;
    }
  >;
  /** Edit non-financial metadata (client name / note) on an
   *  exchange_transactions row (IPC: exchange.updateMetadata). */
  updateExchangeMetadata: (
    payload: UpdateExchangeMetadataPayload,
  ) => Promise<{ success: boolean; data?: any; error?: string }>;

  // ---------------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------------
  getTodayExpenses: () => Promise<any[]>;
  /** Manual expense — core's createExpenseSchema input (bill, cash lines,
   *  change back, not-returned claim). Write envelope. */
  addExpense: (
    payload: CreateExpenseRequest,
  ) => Promise<ApiResult & { id?: number }>;
  deleteExpense: (id: number) => Promise<ApiResult>;
  /** LIRA-262 — record that the shop used one of its own items (inventory
   *  product, or a Katsh / iPick / Whish App catalog item) as an expense at
   *  cost; no cash moves. Write envelope. */
  addStockExpense: (
    payload: CreateStockExpenseInput,
  ) => Promise<ApiResult & { id?: number }>;
  /** Edit non-financial metadata (description/category/note) on an expense
   *  row (the History modal's inline edit). */
  updateExpenseMetadata: (
    data: ExpenseUpdateMetadataPayload,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  getDashboardStats: () => Promise<DashboardStats>;
  getProfitSalesChart: (
    type: "Sales" | "Profit",
    clientDay?: string,
  ) => Promise<ChartDataPoint[]>;
  getTodaysSales: (date?: string) => Promise<RecentSale[]>;
  getDrawerBalances: () => Promise<DrawerBalances>;
  getDebtSummary: () => Promise<any>;
  getInventoryStockStats: () => Promise<StockStats>;
  /** DC-11 (OWNER_NOTES_2026-09-21.md §7.2) — the "Net Profit — last 30
   *  days" tile: Σ net profit over the rolling 30-day window ending on
   *  `clientDay` (defaults to the browser's own `localDay()`). */
  getNetProfitLast30Days: (
    clientDay?: string,
  ) => Promise<NetProfitWindowResult>;
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
  /** LIRA-250 follow-up — today's MTC/Alfa sales count/profit for the
   *  Recharge page's Count/Profit + Total Profit cards
   *  (`RechargeRepository.getTodayStats`). */
  getRechargeTodayStats: (provider: "MTC" | "Alfa") => Promise<{
    count: number;
    profit_usd: number;
    profit_lbp: number;
    byCurrency: Array<{ currency: string; commission: number; count: number }>;
  }>;
  /** Payload derived from `createRechargeSchema` (rule 21) — LIRA-185 #1
   *  added `discount`; a hand-typed copy would not have it. */
  processRecharge: (payload: CreateRechargePayload) => Promise<ApiResult>;
  /** Funding-source drawer balances for the top-up modal opened by
   *  `handleTopUpClick` — feeds all four top-up arms below. Previously a
   *  raw, unguarded `window.api.recharge.getDrawerBalances()` call with no
   *  REST twin, so the modal never opened in web mode. */
  getRechargeDrawerBalances: () => Promise<RechargeDrawerBalance[]>;
  /** Generic drawer-to-drawer top-up into a provider drawer (desktop's only
   *  path to `OMT_App` — CARRIER_LINES_VALIDITY_PLAN.md §8.3). */
  topUpApp: (payload: TopUpAppPayload) => Promise<ApiResult>;
  /** Katsh/iPick/OMT App: the supplier extends credit — no source drawer
   *  moves (D2/D4 — OMT App's default funding path, LIRA-190). */
  topUpFromSupplier: (payload: TopUpFromSupplierPayload) => Promise<ApiResult>;
  /** OMT open-credit account (LIRA-192) — the mirror of topUpFromSupplier:
   *  OMT_App wallet balance leaves, the OMT account is credited principal +
   *  commission (recognised as profit at settlement, wave 2). Admin only. */
  cashoutToSupplier: (
    payload: RechargeCashoutPayload,
  ) => Promise<{ success: boolean; error?: string; commission?: number }>;
  /** Whish App: a partner extends credit — no source drawer moves. */
  topUpFromPartner: (payload: TopUpFromPartnerPayload) => Promise<ApiResult>;
  /**
   * Whish App: a client transfers credits, the shop pays out via
   * `payments[]` legs. Payload type is `TopUpFromClientInput`, derived from
   * `topUpFromClientSchema` (packages/core/src/validators/recharge.ts), not
   * hand-copied (rule 21) — `cashPaid` is retired from the wire, `payments`
   * is required, and `clientId` must be declared here for rule 11
   * propagation to typecheck end to end.
   */
  topUpFromClient: (payload: TopUpFromClientInput) => Promise<ApiResult>;
  /** Edit non-financial metadata (phone number / client name / note) on a
   *  recharge row — the History modal's inline edit (LIRA-109; IPC:
   *  recharge.updateMetadata). Was the last raw `window.api.recharge.*` call
   *  in the Recharge feature. */
  updateRechargeMetadata: (
    payload: UpdateRechargeMetadataPayload,
  ) => Promise<{ success: boolean; data?: any; error?: string }>;

  // ---------------------------------------------------------------------------
  // Services (OMT / Whish / BOB)
  // ---------------------------------------------------------------------------
  getOMTHistory: (provider?: string) => Promise<any[]>;
  getOMTAnalytics: (providers?: string[]) => Promise<OMTAnalytics>;
  /** `code`/`details` carry any `AppError`'s structured payload (e.g. the
   *  FOR-partner secondary-system `BusinessRuleError`) — switch on `code`,
   *  never the message string. No drawer operation is blocked on
   *  insufficient funds: the RECEIVE-payout guard this originally described
   *  (`InsufficientDrawerFundsError`, `code: "INSUFFICIENT_DRAWER_FUNDS"`)
   *  was deleted when the owner reversed the no-overdraw rule 2026-08-01 —
   *  the primary cash drawer may go negative. */
  addOMTTransaction: (
    payload: CreateFinancialServicePayload,
  ) => Promise<ApiResult & { id?: number; code?: string; details?: unknown }>;
  /** A single financial_services record by id — the Debts page's
   *  service-backed debt-detail "eye" button. Raw read (null when missing). */
  getFinancialServiceById: (id: number) => Promise<any | null>;
  /** All payment rows for a unified transaction — the same debt-detail
   *  "eye" button drills into this alongside `getFinancialServiceById`. */
  getPaymentsByTransaction: (transactionId: number) => Promise<any[]>;
  /** Edit non-financial metadata on a financial_services row (OMT/Whish/
   *  iPick/Katsh/Binance history modals' inline edit — one shared channel). */
  updateFinancialMetadata: (
    data: FinancialUpdateMetadataPayload,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  /** Generic, reversible cash transfer between any two of the shop's own
   *  drawers (Primary Cash Drawer plan §8.6) — General <-> the primary cash
   *  drawer (OMT_System/Whish_System) is the pair the UI exposes. Replaces
   *  the retired `drawerTopUp.fundSystem` (one-directional float-funding,
   *  now-superseded 2026-07-29 model). Can itself fail with
   *  `code: "INSUFFICIENT_DRAWER_FUNDS"` if `fromDrawer` lacks funds. */
  transferBetweenDrawers: (
    data: CreateDrawerTransferPayload,
  ) => Promise<ApiResult & { id?: number; code?: string; details?: unknown }>;

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------
  getMaintenanceJobs: (statusFilter?: string) => Promise<any[]>;
  saveMaintenanceJob: (
    payload: SaveMaintenanceJobPayload,
  ) => Promise<ApiResult & { id?: number }>;
  deleteMaintenanceJob: (id: number) => Promise<ApiResult>;
  // LIRA-176 phase 6 — one job's status transition history. Reads return the
  // RAW array (not the envelope) — see the dual-transport contract.
  getMaintenanceStatusHistory: (
    jobId: number,
  ) => Promise<MaintenanceStatusHistoryRow[]>;

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
  /** `day` is the client's own local calendar day (`YYYY-MM-DD`), sent so a
   *  web-hosted server (which doesn't know the shop's timezone) doesn't have
   *  to guess "today". */
  hasOpeningBalanceToday: (day?: string) => Promise<boolean>;
  getDailyStatsSnapshot: (
    input?: DailyStatsSnapshotQuery,
  ) => Promise<DailyStatsSnapshot>;
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
  createCheckpoint: (
    data: CreateCheckpointPayload,
  ) => Promise<{ success: boolean; id?: number; error?: string }>;
  getCheckpointTimeline: (filters?: {
    date_from?: string;
    date_to?: string;
    type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
    drawer_name?: string;
    user_id?: number;
  }) => Promise<{ success: boolean; checkpoints?: any[]; error?: string }>;
  /** LIRA-252 wave 2 — Checkpoint Timeline companion read for manual
   *  carrier-line (MTC/Alfa) drawer adjustments (CARRIER_LINE_ADJUSTMENT
   *  transactions), sibling of `getCheckpointTimeline` above. Filters and
   *  row shape are core's own `ClosingRepository` types (rule 21). */
  getCarrierLineAdjustments: (
    filters?: CarrierLineAdjustmentFilters,
  ) => Promise<{
    success: boolean;
    adjustments?: CarrierLineAdjustmentRecord[];
    error?: string;
  }>;
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
  /** LIRA-289 — per drawer, its last count and the sales since (admin); null on failure. */
  getTransactionsSinceLastCount: (
    drawers: string[],
  ) => Promise<Array<import("@liratek/core").SinceLastCountDrawer> | null>;
  /** Whether initial drawer amounts have ever been set (setup banner). */
  hasInitialBalancesSet: () => Promise<boolean>;
  /** Whether a starting (session-management) checkpoint has ever been recorded. */
  hasStartingCheckpoint: () => Promise<boolean>;
  /** LIRA-252 item A (rule 19/21) — the first-run Setup wizard's finish
   *  step. Desktop-only today (the wizard itself has no web counterpart —
   *  network-DB detection, browse-for-database, relaunch are all Electron
   *  concepts); routed through the adapter anyway so `StepComplete.tsx`
   *  never calls `window.api.setup.*` directly (rule 19), and so a future
   *  web onboarding flow has one function to wire a REST route onto instead
   *  of a raw IPC call embedded in a page. */
  completeSetup: (payload: {
    shop_name: string;
    admin_username: string;
    admin_password: string;
    base_system?: "OMT" | "WHISH";
    enabled_modules: string[];
    enabled_payment_methods: string[];
    session_management_enabled: boolean;
    customer_sessions_enabled: boolean;
    active_currencies?: string[];
    extra_users?: { username: string; password: string; role: string }[];
    whatsapp_phone?: string;
    whatsapp_api_key?: string;
    drawer_amounts?: Array<{
      drawer_name: string;
      currency_code: string;
      amount: number;
    }>;
    drawer_currency_config?: Array<{
      drawer_name: string;
      currency_codes: string[];
    }>;
    carrier_lines?: Array<{
      carrier: "mtc" | "alfa";
      phone_number: string;
      label?: string | null;
      credits?: number;
      validity_expires_at?: string | null;
    }>;
  }) => Promise<{ success: boolean; adminUserId?: number; error?: string }>;

  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------
  getSuppliers: (search?: string, includeInactive?: boolean) => Promise<any[]>;
  getSupplierBalances: (includeInactive?: boolean) => Promise<any[]>;
  getSupplierLedger: (supplierId: number, limit?: number) => Promise<any[]>;
  /** OMT open-credit account (LIRA-188) — per-currency balances for every
   *  account parent, rolled up with its children. No role gate. */
  getSupplierAccountBalances: () => Promise<AccountBalance[]>;
  /** Unioned ledger rows across an account's parent + children, newest
   *  first, each carrying which member it came from. */
  getSupplierAccountLedger: (
    accountSupplierId: number,
    limit?: number,
  ) => Promise<AccountLedgerEntry[]>;
  /** Unioned unsettled rows (financial_services + raw supplier_ledger,
   *  plan §9.3) across an account's parent + children. */
  getSupplierAccountUnsettled: (
    accountSupplierId: number,
  ) => Promise<AccountUnsettledRow[]>;
  /** LIRA-255 — gross owed minus unsettled commission, in OMT's own sign
   *  convention. Display-only; no mutation. */
  getSupplierAccountExpectedStatement: (
    accountSupplierId: number,
  ) => Promise<AccountExpectedStatement>;
  createSupplier: (data: {
    name: string;
    contact_name?: string;
    phone?: string;
    note?: string;
    module_key?: string;
    provider?: string;
  }) => Promise<ApiResult & { id?: number }>;
  /**
   * LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — set (`account_supplier_id`
   * a positive id) or clear (`null`) a supplier's account parent. Payload
   * typed as `SupplierAccountLinkInput` (rule 21 — derived from
   * `supplierAccountLinkSchema`, never hand-copied). The repository
   * re-validates every invariant (self-parent, one-level chains, parent
   * existence/tenant/active, orphaned unsettled rows) server-side.
   */
  updateSupplierAccountLink: (
    data: SupplierAccountLinkInput,
  ) => Promise<ApiResult & { id?: number }>;
  addSupplierLedgerEntry: (
    supplierId: number,
    data: Omit<SupplierLedgerEntryPayload, "supplier_id">,
  ) => Promise<ApiResult & { id?: number }>;
  getUnsettledTransactions: (provider: string) => Promise<any[]>;
  /** Payload derived from the core `supplierSettleSchema` (rule 21) —
   *  includes the Settle sheet's `exchange_rate` (owner decision
   *  2026-10-07, stamped on SUPPLIER_SETTLEMENT). */
  settleTransactions: (
    data: SupplierSettleInput,
  ) => Promise<ApiResult & { id?: number }>;
  /** Pay a supplier down / record a supplier paying us, via payment legs. */
  recordSupplierCashflow: (
    data: SupplierCashflowPayload,
  ) => Promise<ApiResult & { id?: number }>;
  /**
   * OMT open-credit account settlement (LIRA-189, CONTRACT_W2.md §2.1) — ONE
   * payment across the account parent (OMT) + its children (OMT App, iPick),
   * allocated per child by the repository. `accountSupplierId` is the
   * account parent's supplier id (mirrors getSupplierAccountLedger's
   * two-arg shape); `direction` mirrors recordSupplierCashflow's PAY/RECEIVE
   * (here PAY/COLLECT — §8.4: cashout credits can flip the account net
   * negative, needing the collect/RECEIVE path). `selections` is the
   * operator's explicit tick-list from getSupplierAccountUnsettled — the
   * frontend pre-selects oldest-first (D8) but the repository re-validates
   * every id against account membership. Mirrors `@liratek/core`'s
   * `SettleAccountData` verbatim (rule 14), minus `account_supplier_id`
   * (passed separately here) and `created_by` (injected server-side, rule 19c).
   */
  settleSupplierAccount: (
    accountSupplierId: number,
    data: Omit<SupplierSettleAccountPayload, "account_supplier_id">,
  ) => Promise<ApiResult & { id?: number }>;
  // supplierWriteOff REMOVED (supplier stock-intake, D8) — the standalone
  // write-off is gone; recordSupplierCashflow's bundled `discount` leg above
  // is the only surviving forgive-debt path. `debtWriteOff`/`partnerWriteOff`
  // elsewhere in this file are separate, unrelated features — untouched.
  /** All transactions for a provider (history tab) — settled + unsettled. */
  getAllSupplierTransactions: (
    provider: string,
    limit?: number,
  ) => Promise<any[]>;
  /** Per-provider unsettled commission summary (dashboard + profits page). */
  getUnsettledSummary: () => Promise<UnsettledSummary[]>;
  /** Product-supplier aggregate balances (Inventory-linked suppliers). */
  getSupplierProductBalances: () => Promise<any[]>;
  /** Supplier stock-intake: informational per-supplier stock value —
   *  SUM(quantity_remaining * unit_cost_usd) across open batches. */
  getSupplierProductStockValue: () => Promise<
    { supplier_id: number; stock_value_usd: number }[]
  >;
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
  createSupplierPurchase: (data: SupplierPurchaseCreatePayload) => Promise<any>;
  /** LIRA-087 (migration v189) — record a supplier debt without a product
   *  line yet; a later `receiveStock` call can attach products to it via
   *  `attach_to_recorded_debt_id`. */
  recordSupplierDebt: (data: SupplierRecordDebtPayload) => Promise<{
    success: boolean;
    ledgerEntryId?: number;
    transactionId?: number;
    error?: string;
  }>;
  /** The picker list for stock intake's "attach to a recorded debt" flow. */
  getOpenRecordedSupplierDebts: (supplierId: number) => Promise<any[]>;

  // ---------------------------------------------------------------------------
  // Rates (new 4-column schema: to_code, market_rate, delta, is_stronger)
  // ---------------------------------------------------------------------------
  getRates: () => Promise<any[]>;
  setRate: (data: SetRatePayload) => Promise<ApiResult>;
  deleteRate: (to_code: string) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  getNonAdminUsers: () => Promise<any[]>;
  /**
   * Payload type is DERIVED from `createUserSchema`
   * (packages/core/src/validators/user.ts), not hand-copied (rule 21): the
   * schema's `role` is a `"admin" | "staff"` enum, tighter than the plain
   * `string` this signature used to declare, so a typo'd role now fails to
   * typecheck here instead of surfacing only as a 400 at runtime. Same
   * import pattern as `AddRepaymentInput` above.
   */
  createUser: (data: CreateUserInput) => Promise<ApiResult & { id?: number }>;
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
  // Database Reset (LIRA-165) — admin-only. `getDatabaseResetPreview` is a
  // READ: resolves to the RAW `DatabaseResetPreview` shape, throwing on
  // failure. `resetDatabase` is a WRITE: resolves to the envelope untouched
  // so the caller branches on `result.success` itself (rule 19).
  // ---------------------------------------------------------------------------
  getDatabaseResetPreview: () => Promise<DatabaseResetPreview>;
  resetDatabase: (input: DatabaseResetPayload) => Promise<{
    success: boolean;
    data?: DatabaseResetResult;
    error?: string;
  }>;

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
  // Service Providers (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phases 4a + 5)
  // ---------------------------------------------------------------------------
  /** Active `service_providers`, ordered by `sort_order` — powers the
   *  Partners "System Association" dropdown with the real provider list. */
  getActiveServiceProviders: () => Promise<ServiceProviderEntity[]>;
  /** ALL `service_providers` (including inactive/system) — the Settings
   *  management UI. */
  getServiceProviders: () => Promise<ServiceProviderEntity[]>;
  /** Always settles the new provider's cash to `General` server-side —
   *  there is no `drawer_name` field to set here (owner decision, §5b). */
  createServiceProvider: (
    data: CreateServiceProviderPayload,
  ) => Promise<ApiResult & { id?: number }>;
  /** `code` is not an updatable field — see `ServiceProviderService`'s doc
   *  comment for why. */
  updateServiceProvider: (
    id: number,
    data: UpdateServiceProviderPayload,
  ) => Promise<ApiResult>;
  /** Rejects with a clear error for one of the 9 seeded system providers. */
  deleteServiceProvider: (id: number) => Promise<ApiResult>;

  // ---------------------------------------------------------------------------
  // Carrier Lines (LIRA W6.a — shop SIM-line tracking; informational only)
  // ---------------------------------------------------------------------------
  getActiveCarrierLines: (
    carrier: "alfa" | "mtc",
  ) => Promise<CarrierLineEntity[]>;
  getAllActiveCarrierLines: () => Promise<CarrierLineEntity[]>;
  getAdminCarrierLines: () => Promise<CarrierLineEntity[]>;
  createCarrierLine: (
    data: CarrierLineCreatePayload,
  ) => Promise<CarrierLineWriteResult>;
  updateCarrierLine: (
    id: number,
    data: Omit<CarrierLineUpdatePayload, "id">,
  ) => Promise<CarrierLineWriteResult>;
  /** Recharge-tab inline quick-update: credits and/or a new expiry date. */
  updateCarrierLineBalance: (
    id: number,
    data: Omit<CarrierLineUpdateBalancePayload, "id">,
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
  /** LIRA-145: book a shop line's consumed credits as a `Line_Usage` expense
   *  (admin/staff). One server-side db transaction: expense row + unified
   *  EXPENSE transaction + one payment leg on the carrier credit drawer + a
   *  linked `carrier_line_movements` row. Face value, USD only. Rejections
   *  come back as `{ success: false, error }`, never as a throw. */
  recordCarrierLineUsage: (
    data: CarrierLineUsagePayload,
  ) => Promise<CarrierLineUsageResult>;
  /** v184 (#28, LIRA-218) — the "days still to send" list: every PENDING
   *  delivery, across every line. Read-only. */
  getPendingCarrierLineOwedDeliveries: () => Promise<CarrierLineOwedDeliveryListResult>;
  /** v184 (#28) — mark a pending delivery as physically sent to the
   *  customer. Pure checklist bookkeeping: no second sale, no second charge,
   *  no `days_owed` write. */
  markCarrierLineOwedDeliverySent: (
    deliveryId: number,
  ) => Promise<MarkCarrierLineOwedDeliverySentResult>;

  // ---------------------------------------------------------------------------
  // Mobile Service Items — admin (LIRA W6.b) + LIRA-090
  // ---------------------------------------------------------------------------
  /** Active catalog items (public read — no role gate). */
  getActiveMobileServiceItems: () => Promise<MobileServiceItemEntity[]>;
  getAdminMobileServiceItems: () => Promise<MobileServiceItemEntity[]>;
  /** Total catalog row count — used to decide whether to re-seed an empty
   *  catalog (fresh install, or after a "Reset Data" wipe). Envelope-shaped
   *  (not unwrapped): callers must branch on `.success` to tell "count is
   *  genuinely 0" apart from "the fetch failed". */
  countMobileServiceItems: () => Promise<{
    success: boolean;
    data?: number;
    error?: string;
  }>;
  /** Bulk-insert the fresh-install catalog. No-ops server-side (returns
   *  `{success:true, count:0}`) when the table is already populated. Admin
   *  or staff only. */
  seedMobileServiceItems: (items: MobileServiceItemCreatePayload[]) => Promise<{
    success: boolean;
    count?: number;
    error?: string;
  }>;
  /** LIRA-090: create a new catalog item (admin only). */
  createMobileServiceItem: (data: MobileServiceItemCreatePayload) => Promise<{
    success: boolean;
    data?: MobileServiceItemEntity;
    error?: string;
  }>;
  updateMobileServiceItem: (
    id: number,
    data: Omit<MobileServiceItemUpdatePayload, "id">,
  ) => Promise<{
    success: boolean;
    data?: MobileServiceItemEntity;
    error?: string;
  }>;
  /** Flip a catalog item's `is_active` flag (admin only). */
  toggleActiveMobileServiceItem: (id: number) => Promise<{
    success: boolean;
    data?: MobileServiceItemEntity;
    error?: string;
  }>;
  /** Hard-delete a catalog item (admin only). */
  deleteMobileServiceItem: (id: number) => Promise<{
    success: boolean;
    error?: string;
  }>;
  /** LIRA-090 §5.2: charge a telecom catalog item to the shop's own carrier
   *  line. No customer is debited; debits the iPick/Katsh LBP drawer.
   *  Admin or staff only. Send `client_day` (the shop's own `localDay()`) —
   *  the server's day is not trustworthy on web (rule 27). */
  selfChargeTelecomItem: (data: SelfChargeTelecomItemPayload) => Promise<{
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
  getCountableDrawerCurrencies: () => Promise<Record<string, string[]>>;
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
    checkout: (data: SessionCheckoutPayload) => Promise<any>;
  };

  /** Hold money — cash held in / collected out on the customer's behalf
   *  (LIRA-214, migration v183: partial pickup + a real payment form on
   *  both ends). */
  holdMoney: {
    list: (filter?: {
      status?: "held" | "collected";
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    active: () => Promise<{
      success: boolean;
      data?: any[];
      error?: string;
    }>;
    create: (
      data: HoldMoneyCreateInput,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    pickups: (
      holdMoneyId: number,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    collect: (
      data: HoldMoneyCollectPayload,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    voidPickup: (
      pickupId: number,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
  };

  /** Service presets — config CRUD for custom-service templates. */
  servicePresets: {
    list: (filter?: {
      category?: string;
      includeInactive?: boolean;
    }) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    create: (
      data: ServicePresetCreatePayload,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: ServicePresetUpdatePayload,
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
    create: (
      data: PartnerCreatePayload,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    update: (
      id: number,
      data: PartnerUpdatePayload,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deactivate: (id: number) => Promise<{ success: boolean; error?: string }>;
    activate: (id: number) => Promise<{ success: boolean; error?: string }>;
    recordTransaction: (
      data: PartnerRecordTransactionPayload,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    /** Payload derived from the core `partnerSettleSchema` (rule 21):
     *  CQ-10 bundled `discount`, CQ-11 split `payments[]` (legs locked to
     *  `currency`), and the settle modal's `exchange_rate` (owner decision
     *  2026-10-07 — stamped on the PARTNER_SETTLEMENT row). */
    settle: (
      data: PartnerSettleInput,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    /** CQ-10: standalone partner write-off (admin-only) — we forgive what
     *  the partner owes us; capped server-side at the outstanding balance
     *  per currency. */
    writeOff: (
      data: PartnerWriteOffPayload,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
  };

  /** Vouchers (gift cards) — config CRUD. Channels return the service
   *  envelope directly ({ success, voucher?/vouchers?, error? }). */
  vouchers: {
    /** `day` is the client's own local calendar day (`YYYY-MM-DD`), sent so a
     *  web-hosted server (which doesn't know the shop's timezone) doesn't
     *  misclassify a voucher's pending/expired status. */
    getAll: (
      filters?: {
        status?: string;
        clientId?: number;
      },
      day?: string,
    ) => Promise<{ success: boolean; vouchers?: any[]; error?: string }>;
    create: (
      data: VoucherCreatePayload,
    ) => Promise<{ success: boolean; voucher?: any; error?: string }>;
    validate: (
      code: string,
      day?: string,
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
    create: (
      data: CreateDrawerCashoutPayload,
    ) => Promise<{ success: boolean; id?: number; error?: string }>;
    getHistory: (
      limit?: number,
    ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  };

  /** Wallet exchange — convert a provider wallet's OWN USD balance to LBP
   *  (or vice versa), OMT App / Whish App only, never General. */
  walletExchange: {
    create: (data: CreateWalletExchangePayload) => Promise<{
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

  /** Exchange lots — cost-basis lot tracking read/admin API for
   *  exotic-currency exchange positions (EXCHANGE_LOT_SETTLEMENT.md Phase
   *  4a). Reads return the raw data shape (throwing on failure); `adjust`
   *  is a write and returns the envelope untouched. */
  exchangeLots: {
    preview: (data: PreviewLotSettlementPayload) => Promise<
      | { lotTracked: false; reason?: "NO_RATE_ANCHOR" }
      | {
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
    >;
    getPositions: () => Promise<
      Array<{
        currency_code: string;
        open_qty: number;
        avg_unit_cost_usd: number;
        lot_count: number;
        current_market_unit_usd: number | null;
        unrealized_profit_usd: number | null;
      }>
    >;
    getBreakdown: (exchangeId: number) => Promise<{
      asSettler: any[];
      againstSource: any[];
    }>;
    adjust: (
      data: AdjustLotPositionPayload,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
  };

  /** Product Units — LIRA-143 Phase 5 (phone IMEI units & warranty)
   *  intake/read API. Reads return the raw data shape (throwing on
   *  failure); `register`/`delete` are writes and return the envelope
   *  untouched. */
  productUnits: {
    register: (data: RegisterProductUnitsPayload) => Promise<{
      success: boolean;
      data?: {
        units: any[];
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
    ) => Promise<any[]>;
    /** The Phone Units management view — filtered, paginated, warranty-
     *  stamped units across all products. RAW read: resolves to
     *  `{ rows, total }`, throws on failure. */
    list: (filters: ProductUnitListFilters) => Promise<ProductUnitListResult>;
    getSummary: (
      productIds: number[],
    ) => Promise<
      Record<number, { in_stock: number; sold: number; defective: number }>
    >;
    delete: (unitId: number) => Promise<{ success: boolean; error?: string }>;
    getStory: (imei: string) => Promise<any[]>;
    /** Phase 6 refund UI — the units linked to a sale being refunded. */
    getForSaleItems: (saleItemIds: number[]) => Promise<any[]>;
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
  getCustomServices: (filter?: {
    date?: string;
    /** LIRA-083 — filter by work status. */
    workStatus?: "Received" | "In_Progress" | "Ready" | "Delivered";
  }) => Promise<any[]>;
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
  /** Rule 21: the core schema's input type (createCustomServiceSchema). */
  addCustomService: (
    data: CreateCustomServicePayload,
  ) => Promise<ApiResult & { id?: number }>;
  deleteCustomService: (id: number) => Promise<ApiResult>;
  /** LIRA-155 — advance an insurance-style custom service's fulfilment
   *  status (ORDERED -> ISSUED -> RECEIVED -> DELIVERED). Moves no money;
   *  an illegal/not-found transition answers { success: false, error }. */
  advanceCustomServiceFulfillment: (
    data: UpdateCustomServiceFulfillmentPayload,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  /** LIRA-083 — set a custom service's WORK status (Received/In_Progress/
   *  Ready/Delivered). Separate axis from fulfillment above and from the
   *  accounting `status`; no transition-legality check. */
  setCustomServiceWorkStatus: (
    data: UpdateCustomServiceWorkStatusPayload,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  /** Edit non-financial metadata (description/client name/phone/note) on a
   *  custom_services row (the History modal's inline edit). */
  updateCustomServiceMetadata: (
    data: CustomServiceUpdateMetadataPayload,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;

  // ---------------------------------------------------------------------------
  // Unified Transactions
  // ---------------------------------------------------------------------------
  getRecentTransactions: (
    limit?: number,
    filters?: Record<string, unknown>,
  ) => Promise<any[]>;
  getTransactionById: (id: number) => Promise<any>;
  /** RCP-3 service-receipt reprint (rule 19 fix) — customer-facing payment
   *  legs for a transaction (TransactionService.getCustomerFacingLegs). */
  getCustomerFacingLegs: (transactionId: number) => Promise<any[]>;
  /** D1 — currency in/out by business date (the Audit page's Cash Report). */
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
   *  only — amount/currencyCode must net to the original's own total).
   *  LIRA-143 phase 5: `unitExtras` is optional too — the phone-refund UI's
   *  per-unit defective/warranty-override flags, sent on the SAME call.
   *  LIRA-236: `exchangeRate` is optional too — when given, the server
   *  validates `refundLegs` by TOTAL VALUE at that rate instead of the old
   *  per-currency exact match, so cross-currency legs are accepted. */
  refundTransaction: (
    id: number,
    refundLegs?: RefundLegInput[],
    unitExtras?: RefundUnitExtraInput[],
    exchangeRate?: number,
    /** Owner decision 2026-10-07 — refund kept change (only with a
     *  `refundLegs` override; the server checks it). */
    keptChange?: RefundKeptChangeInput,
  ) => Promise<ApiResult & { refundId?: number }>;
  /** LIRA-236 — the Transactions-page refund modal's `bookedRate`/
   *  `bookedRateSource` default (the transaction's own recorded rate, else
   *  the day's fallback). Read-only, no write. */
  getRefundBookedRate: (id: number) => Promise<
    | {
        success: true;
        bookedRate: number;
        bookedRateSource: "sale" | "transaction" | "fallback";
      }
    | { success: false; error?: string }
  >;
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
  /** LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C) — void/refund every
   *  item in a customer-session basket, plus its pooled cash leg(s) and
   *  pooled debt, in ONE transaction. Replaces the "Basket item — see
   *  admin to reverse" dead end. Mirrors voidCheckoutGroup above (rule 14). */
  voidSessionBasket: (sessionId: number) => Promise<
    ApiResult & {
      sessionId?: number;
      itemCount?: number;
      reversedTransactionIds?: number[];
      reversalIds?: number[];
    }
  >;
  refundSessionBasket: (sessionId: number) => Promise<
    ApiResult & {
      sessionId?: number;
      itemCount?: number;
      reversedTransactionIds?: number[];
      reversalIds?: number[];
    }
  >;
  /** LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — item-level sibling
   *  of refundSessionBasket above: refund ONE (or, with saleItemId omitted
   *  on a SALE member, every remaining) line of a customer-session basket
   *  item, reducing the basket's outstanding account charge first. */
  refundSessionBasketItem: (
    payload: SessionItemRefundPayload,
  ) => Promise<
    | ({ success: true } & RefundSessionBasketItemResult)
    | { success: false; error?: string }
  >;
  /** Read-only preview for the item-refund form's pre-fill (the account
   *  reduction + default proportional legs). */
  getSessionItemRefundPreview: (
    payload: SessionItemRefundPreviewPayload,
  ) => Promise<
    | ({ success: true } & SessionItemRefundPreview)
    | { success: false; error?: string }
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
  getProfitSummary: (from: string, to: string) => Promise<ProfitSummary>;
  getProfitByModule: (from: string, to: string) => Promise<ProfitByModule[]>;
  getProfitByDate: (from: string, to: string) => Promise<any[]>;
  getProfitByPaymentMethod: (from: string, to: string) => Promise<any[]>;
  getProfitByUser: (from: string, to: string) => Promise<any[]>;
  getProfitsPasswordStatus: () => Promise<{ isSet: boolean }>;
  setProfitsPassword: (
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  unlockProfits: (
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  lockProfits: () => Promise<{ success: boolean }>;
  getProfitByClient: (
    from: string,
    to: string,
    limit?: number,
  ) => Promise<any[]>;
  getPendingProfit: (from: string, to: string) => Promise<any>;
  // PROF-DD (2026-09-24, OWNER_NOTES_REMAINING_BUILD.md #14 slice 2) — the By
  // Module drill-down's "Show transactions" list.
  getProfitModuleDetail: (
    moduleKey: string,
    from: string,
    to: string,
  ) => Promise<ProfitModuleDetail>;
  getProfitsCommissions: (
    from: string,
    to: string,
  ) => Promise<CommissionsReport>;

  // ---------------------------------------------------------------------------
  // Loto
  // ---------------------------------------------------------------------------
  loto: LotoApi;
};

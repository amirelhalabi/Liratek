/**
 * Zod schemas for IPC handler input validation.
 *
 * These schemas guard every write-path IPC handler. They run before any data
 * touches the database, catching malformed or malicious payloads early.
 */

import { z } from "zod";
// LIRA-306 T041 lifts (see the ClientCreateSchema / AddExpenseSchema /
// TransactionVoidSchema notes below).
import {
  clientWriteSchema as coreClientWriteSchema,
  createExpenseSchema as coreCreateExpenseSchema,
  transactionVoidSchema as coreTransactionVoidSchema,
  transactionRefundSchema as coreTransactionRefundSchema,
  type ClientWriteInput,
  type CreateExpenseInput,
  type TransactionVoidInput,
  type TransactionRefundInput,
} from "@liratek/core";
import {
  saleProcessSchema,
  lotoSellSchema,
  lotoCashPrizeSchema,
  lotoTicketUpdateSchema,
  lotoFeeSchema,
  lotoCheckpointCreateSchema,
  lotoCheckpointUpdateSchema,
  lotoCheckpointSettleSchema,
  lotoCheckpointsSettleBatchSchema,
  sessionCheckoutSchema,
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
  holdMoneyCreateSchema,
  holdMoneyCollectSchema,
  holdMoneyVoidPickupSchema,
  debtCashOutSchema,
  debtAccountEntrySchema,
  addRepaymentSchema,
  debtMonthRowsSchema,
  debtUseCreditSchema,
  debtWriteOffSchema,
  voucherCreateSchema,
  voucherCancelSchema,
  supplierLedgerEntrySchema,
  supplierSettleSchema,
  // OMT open-credit account settlement (LIRA-189, CONTRACT_W2.md §2.1) — the
  // cast-bridge pattern immediately below mirrors SupplierSettleSchema's.
  supplierSettleAccountSchema,
  // LIRA-344 — Remove credit (same cast-bridge pattern).
  removeAccountCreditSchema,
  omtCoveredTypesSchema,
  accountMonthSchema,
  accountDaySchema,
  accountExpectedStatementParamsSchema,
  supplierDayRangeSchema,
  supplierCashflowSchema,
  supplierPurchaseCreateSchema,
  // LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — same cast-bridge pattern.
  supplierAccountLinkSchema,
  // LIRA-087 (migration v189) — same cast-bridge pattern.
  supplierRecordDebtSchema,
  receiveStockSchema,
  partnerRecordTransactionSchema,
  partnerSettleSchema,
  partnerWriteOffSchema,
  partnerSettleDaysSchema,
  partnerMonthRowsSchema,
  partnerDayDetailSchema,
  stockAdjustSchema,
  productListFiltersSchema,
  batchDeleteProductIdsSchema,
  type BatchDeleteProductIds,
  batchUpdateProductsSchema,
  type BatchUpdateProductsInput,
  productFormCreateSchema,
  productFormUpdateSchema,
  productFormInputSchema,
  type ProductFormCreateInput,
  type ProductFormUpdateInput,
  type ProductFormInput,
  setItemCostSchema,
  type SetItemCostInput,
  voidCheckoutGroupSchema,
  sessionBasketReversalSchema,
  refundLegsSchema,
  // LIRA-236 — the cashier-typed exchange rate, shared (rule 14) with every
  // other refund payload schema.
  refundExchangeRateSchema,
  // Owner decision 2026-10-07 — refund kept change (transactions:refund's
  // fifth positional argument), shared with the REST route (rule 14).
  refundKeptChangeSchema,
  type RefundKeptChangeInput,
  // LIRA-342 — the customer gives money back during a refund.
  type RefundAddedChangeInput,
  carrierLineCreateSchema,
  carrierLineUpdateSchema,
  carrierLineUpdateBalanceSchema,
  recordCarrierLineUsageSchema,
  markCarrierLineOwedDeliverySentSchema,
  mobileServiceItemUpdateSchema,
  mobileServiceItemCreateSchema,
  mobileServiceItemSeedSchema,
  createDrawerCashoutSchema,
  createWalletExchangeSchema,
  createDrawerTransferSchema,
  createServiceProviderSchema,
  updateServiceProviderSchema,
  previewLotSettlementSchema,
  lotBreakdownSchema,
  adjustLotPositionSchema,
  type PreviewLotSettlementInput,
  type LotBreakdownInput,
  type AdjustLotPositionInput,
  selfChargeTelecomItemSchema,
  createRechargeSchema,
  topUpAppSchema,
  topUpFromSupplierSchema,
  topUpFromPartnerSchema,
  topUpFromClientSchema,
  updateRechargeMetadataSchema,
  // OMT open-credit account (LIRA-192) — the cashout write, mirroring
  // topUpFromSupplier's cast-bridge pattern immediately below (rule 14/19b).
  rechargeCashoutSchema,
  type CreateRechargeInput,
  type TopUpAppInput,
  type TopUpFromSupplierInput,
  type TopUpFromPartnerInput,
  type TopUpFromClientInput,
  type UpdateRechargeMetadataInput,
  type RechargeCashoutInput,
  type SelfChargeTelecomItemInput,
  type StockAdjustInput,
  type ProductListFilters,
  type VoidCheckoutGroupInput,
  type SessionBasketReversalInput,
  type RefundLegsInput,
  type CarrierLineCreateInput,
  type CarrierLineUpdateInput,
  type CarrierLineUpdateBalanceInput,
  type RecordCarrierLineUsageInput,
  type MarkCarrierLineOwedDeliverySentInput,
  type MobileServiceItemUpdateInput,
  type MobileServiceItemCreateInput,
  type VoucherCreateInput,
  type VoucherCancelInput,
  type DebtCashOutInput,
  type DebtAccountEntryInput,
  type AddRepaymentInput,
  type DebtMonthRowsInput,
  type DebtUseCreditInput,
  type DebtWriteOffInput,
  type HoldMoneyCreateInput,
  type HoldMoneyCollectInput,
  type HoldMoneyVoidPickupInput,
  type SaleProcessInput,
  type LotoSellInput,
  type LotoCashPrizeInput,
  type LotoTicketUpdateInput,
  type LotoFeeInput,
  type LotoCheckpointCreateInput,
  type LotoCheckpointUpdateInput,
  type LotoCheckpointSettleInput,
  type LotoCheckpointsSettleBatchInput,
  type SessionCheckoutInput,
  type RechargeBasketCheckoutInput,
  type RechargePartnerOrderInput,
  type SupplierLedgerEntryInput,
  type SupplierSettleInput,
  type SupplierSettleAccountInput,
  type RemoveAccountCreditInput,
  type OmtCoveredTypesInput,
  type AccountMonthInput,
  type AccountDayInput,
  type AccountExpectedStatementParamsInput,
  type SupplierDayRangeInput,
  type SupplierCashflowInput,
  type SupplierPurchaseCreateInput,
  type SupplierAccountLinkInput,
  type SupplierRecordDebtInput,
  type ReceiveStockInput,
  type PartnerRecordTransactionInput,
  type PartnerSettleInput,
  type PartnerWriteOffInput,
  type PartnerSettleDaysInput,
  type PartnerMonthRowsInput,
  type PartnerDayDetailInput,
  type CreateDrawerCashoutInput,
  type CreateWalletExchangeInput,
  type CreateDrawerTransferInput,
  type CreateServiceProviderInput,
  type UpdateServiceProviderInput,
  updateExchangeMetadataSchema,
  type UpdateExchangeMetadataInput,
  updateCustomServiceFulfillmentSchema,
  type UpdateCustomServiceFulfillmentInput,
  updateCustomServiceWorkStatusSchema,
  type UpdateCustomServiceWorkStatusInput,
  exchangeSubmitSchema,
  type ExchangeSubmitInput,
  refundUnitExtrasSchema,
  type RefundUnitExtrasInput,
  // LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — session-basket
  // single-item refund payload/preview contracts, shared with the REST
  // route the same way (rule 14): packages/core/src/validators/
  // transaction.ts.
  sessionItemRefundSchema,
  type SessionItemRefundInput,
  sessionItemRefundPreviewSchema,
  type SessionItemRefundPreviewInput,
  // LIRA-309 — phone lines held for sale (packages/core/src/validators/resaleLine.ts).
  listResaleLinesQuerySchema,
  saveResaleLineSchema,
  writeOffResaleLineSchema,
  rechargeResaleLineSchema,
  type RechargeResaleLineData,
  giveBackResaleLineSchema,
  type GiveBackResaleLineData,
  type ListResaleLinesQuery,
  type SaveResaleLineData,
  type WriteOffResaleLineData,
  // LIRA-312 — wrong-number card recharges (packages/core/src/validators/wrongNumber.ts).
  listWrongNumbersQuerySchema,
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
  wrongNumberSaleCardQuerySchema,
  type ListWrongNumbersQuery,
  type RecordWrongNumberData,
  type WrongNumberCreditsData,
  type WrongNumberSaleCardQuery,
  registerProductUnitsSchema,
  productUnitsForProductSchema,
  listProductUnitsSchema,
  productUnitsSummarySchema,
  productUnitIdSchema,
  unitStoryQuerySchema,
  unitsForSaleItemsSchema,
  resolveScanCodeSchema,
  createCategorySchema,
  updateCategorySchema,
  // LIRA-296 — warranty for any item (packages/core/src/validators/warranty.ts).
  warrantySearchSchema,
  type WarrantySearchQuery,
  createWarrantyClaimSchema,
  warrantyClaimsForSchema,
  voidWarrantyClaimSchema,
  listDefectiveItemsSchema,
  resolveDefectiveSchema,
  createSupplierReturnSchema,
  closeSupplierReturnSchema,
  listSupplierReturnsSchema,
  warrantyReportSchema,
  type CreateSupplierReturnInput,
  type CloseSupplierReturnInput,
  type ListSupplierReturnsInput,
  type WarrantyReportInput,
  type CreateWarrantyClaimData,
  type WarrantyClaimsForInput,
  type VoidWarrantyClaimInput,
  type ListDefectiveItemsInput,
  type ResolveDefectiveInput,
  type RegisterProductUnitsInput,
  type ProductUnitsForProductInput,
  type ListProductUnitsInput,
  type ProductUnitsSummaryInput,
  type ProductUnitIdInput,
  type UnitStoryQueryInput,
  type UnitsForSaleItemsInput,
  type ResolveScanCodeInput,
  type CreateCategoryInput,
  type UpdateCategoryInput,
  // Frozen contract names these two PascalCase (packages/core/src/validators/
  // profits.ts) — aliased on import to avoid colliding with the local
  // re-exports of the same name a few lines below.
  SetProfitsPasswordSchema as coreSetProfitsPasswordSchema,
  UnlockProfitsSchema as coreUnlockProfitsSchema,
  type SetProfitsPasswordInput,
  type UnlockProfitsInput,
  // LIRA-176 phase 4 — no local duplicate for this one (it's brand new), so
  // it re-exports straight from core via the same cast-bridge pattern as
  // RechargeSchema/SaleProcessSchema above.
  getMaintenanceStatusHistorySchema,
  type GetMaintenanceStatusHistoryInput,
  // LIRA-185 D9 — re-exported straight from core (same cast-bridge pattern)
  // to replace the LOCAL duplicate below that was missing paid_by/note/
  // transaction_time entirely (rule 23 three-way key diff: those three keys
  // exist in core's schema and are read by MaintenanceRepository/
  // MaintenanceService, but had no key at all in the old local duplicate —
  // Zod silently stripped them from every desktop save).
  saveMaintenanceJobSchema,
  type SaveMaintenanceJobInput,
  // LIRA-165 — Database Reset. Brand new, no local duplicate; straight
  // re-export from packages/core/src/validators/databaseReset.ts so the
  // Electron IPC handler (databaseResetHandlers.ts) and the REST route
  // validate against the same schema (rule 14).
  databaseResetSchema,
  // TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3 — five "...:update-metadata"
  // IPC handlers (sales/expenses/financial/custom-services/loto) validated
  // nothing beyond requireRole while their REST twins already validated
  // against these core schemas, so REST was silently stricter than desktop.
  // Straight re-exports, no local duplicate (rule 14).
  saleUpdateMetadataSchema,
  type SaleUpdateMetadataInput,
  // LIRA-231 — POS "Refund Sale"/"Refund item" buttons' operator-chosen
  // return-method override + refund-preview read, shared with the REST
  // routes via packages/core/src/validators/sale.ts (rule 14/19b).
  saleRefundSchema,
  type SaleRefundInput,
  saleRefundItemSchema,
  type SaleRefundItemInput,
  // LIRA-147 — admin-only "Undo refund" for a per-item refund, shared with
  // the REST route via packages/core/src/validators/sale.ts (rule 14/19b).
  saleUndoItemRefundSchema,
  type SaleUndoItemRefundInput,
  saleRefundPreviewSchema,
  type SaleRefundPreviewInput,
  expenseUpdateMetadataSchema,
  type ExpenseUpdateMetadataInput,
  // LIRA-262 — "shop used its own stock" expense, shared with
  // POST /api/expenses/stock-use (rule 14/19b).
  createStockExpenseSchema,
  type CreateStockExpenseData,
  financialUpdateMetadataSchema,
  type FinancialUpdateMetadataInput,
  customServiceUpdateMetadataSchema,
  type CustomServiceUpdateMetadataInput,
  lotoUpdateMetadataSchema,
  type LotoUpdateMetadataInput,
  // User management (create/password/active/role) — shared with the REST
  // routes via packages/core/src/validators/user.ts (rule 14/19b). Cast
  // bridges the zod major mismatch (core types against zod 4, this
  // workspace types against zod 3); the runtime API used is identical.
  createUserSchema as coreCreateUserSchema,
  setUserPasswordSchema as coreSetUserPasswordSchema,
  setUserActiveSchema as coreSetUserActiveSchema,
  setUserRoleSchema as coreSetUserRoleSchema,
  type CreateUserInput,
  type SetUserPasswordInput,
  type SetUserActiveInput,
  type SetUserRoleInput,
  // LIRA-293 — change your own password (the ONE password rule).
  changeOwnPasswordSchema as coreChangeOwnPasswordSchema,
  type ChangeOwnPasswordInput,
  // LIRA-331 — a user's own UI language (shared with the REST route).
  setMyLanguageSchema as coreSetMyLanguageSchema,
  type SetMyLanguageInput,
  // DC-10/DC-11 dashboard chart + net-profit-tile query validation
  // (OWNER_NOTES_2026-09-21.md §7.2) — shared with the REST routes via
  // packages/core/src/validators/dashboard.ts (rule 14/19b).
  dashboardChartQuerySchema,
  netProfitWindowQuerySchema,
  type DashboardChartQueryInput,
  type NetProfitWindowQueryInput,
  // LIRA-219 (C.4) — the closing checkpoint's daily-stats-snapshot query,
  // shared with the REST route via packages/core/src/validators/closing.ts
  // (rule 14/19b).
  dailyStatsSnapshotQuerySchema,
  type DailyStatsSnapshotQuery,
  // LIRA-289 — closing:get-since-last-count, shared with the REST route.
  sinceLastCountQuerySchema,
} from "@liratek/core";
// LIRA-297 item 3 — session / daily-closing / voucher-image write contracts
// (re-exported below the Customer Sessions checkout block).
import {
  startSessionIpcSchema,
  updateSessionSchema,
  sessionCartAddSchema,
  linkSessionTransactionSchema,
  updateDailyClosingIpcSchema,
  setVoucherImageSchema,
  type StartSessionIpcInput,
  type UpdateSessionInput,
  type SessionCartAddInput,
  type LinkSessionTransactionInput,
  type UpdateDailyClosingIpcInput,
  type SetVoucherImageInput,
} from "@liratek/core";
// LIRA-297 item 3 — supplier create, drawer top-up, currency and
// payment-method write contracts (lifted to / written in core so the REST
// twins validate against the same schema; re-exported in their sections).
import {
  supplierCreateSchema,
  drawerTopUpCreateSchema,
  drawerTopUpFromDrawerSchema,
  createCurrencySchema,
  updateCurrencySchema,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  type SupplierCreateInput,
  type DrawerTopUpCreateInput,
  type DrawerTopUpFromDrawerInput,
  type CreateCurrencyInput,
  type UpdateCurrencyInput,
  type CreatePaymentMethodInput,
  type UpdatePaymentMethodInput,
} from "@liratek/core";

// =============================================================================
// Sales
// =============================================================================

// The sale-processing contract lives in packages/core/src/validators/sale.ts
// so the Electron IPC handler and the REST route validate against ONE schema
// (CLAUDE.md rule 14). Re-exported under the historical local name.
// Cast bridges the zod major mismatch (core types against zod 4, this
// workspace types against zod 3); the runtime API used is identical.
export const SaleProcessSchema =
  saleProcessSchema as unknown as z.ZodSchema<SaleProcessInput>;

// LIRA-231 — POS "Refund Sale" (whole sale), "Refund item", and the
// refund-preview read, all sharing the LIRA-078 refund-leg-override contract
// (packages/core/src/validators/sale.ts, rule 14). Cast bridges the zod
// major mismatch, same as SaleProcessSchema above. `SaleRefundSchema` was
// previously an unused bare `z.number().int().positive()` — replaced here,
// not extended, since nothing depended on that shape.
export const SaleRefundSchema =
  saleRefundSchema as unknown as z.ZodSchema<SaleRefundInput>;
export const SaleRefundItemSchema =
  saleRefundItemSchema as unknown as z.ZodSchema<SaleRefundItemInput>;
export const SaleUndoItemRefundSchema =
  saleUndoItemRefundSchema as unknown as z.ZodSchema<SaleUndoItemRefundInput>;
export const SaleRefundPreviewSchema =
  saleRefundPreviewSchema as unknown as z.ZodSchema<SaleRefundPreviewInput>;

// DC-10/DC-11 (OWNER_NOTES_2026-09-21.md §7.2): the dashboard chart's
// "Profit" series and the "Net Profit — last 30 days" tile both read a
// rolling 30-day window ending on the CLIENT's own calendar day (rule 27).
// Cast bridges the zod major mismatch, same as SaleProcessSchema above.
export const DashboardChartQuerySchema =
  dashboardChartQuerySchema as unknown as z.ZodSchema<DashboardChartQueryInput>;
export const NetProfitWindowQuerySchema =
  netProfitWindowQuerySchema as unknown as z.ZodSchema<NetProfitWindowQueryInput>;

// LIRA-219 (C.4) — `closing:get-daily-stats-snapshot`'s optional `{day}`
// payload. Cast bridges the zod major mismatch, same as the schemas above.
export const DailyStatsSnapshotQuerySchema =
  dailyStatsSnapshotQuerySchema as unknown as z.ZodSchema<DailyStatsSnapshotQuery>;

// LIRA-289 — `closing:get-since-last-count` `{drawers}` (normalized to an array).
export const SinceLastCountQuerySchema =
  sinceLastCountQuerySchema as unknown as z.ZodSchema<{ drawers: string[] }>;

// =============================================================================
// Inventory
// =============================================================================

// The product create/update contract lives in
// packages/core/src/validators/product.ts (`productFormCreateSchema` /
// `productFormUpdateSchema`, LIRA-297) so the frontend adapters derive their
// payload types from the SAME definition this channel validates against
// (rules 14/21). Lifted verbatim, with one fix: create accepts a null/absent
// `barcode` (the CSV import sends null for a code-less row; the service
// auto-generates one). Cast bridges the zod major mismatch (core types
// against zod 4, this workspace types against zod 3); the runtime API used
// is identical.

/** Create: id must NOT be sent — the database auto-generates it. */
export const ProductCreateSchema =
  productFormCreateSchema as unknown as z.ZodSchema<ProductFormCreateInput>;

/** Update: id is required to identify the row to modify. */
export const ProductUpdateSchema =
  productFormUpdateSchema as unknown as z.ZodSchema<ProductFormUpdateInput>;

/** @deprecated Use ProductCreateSchema or ProductUpdateSchema instead. */
export const ProductInputSchema =
  productFormInputSchema as unknown as z.ZodSchema<ProductFormInput>;

// The batch-update contract lives in packages/core/src/validators/product.ts
// so the IPC handler and the REST route
// (`POST /api/inventory/products/batch-update`) validate against ONE schema
// (CLAUDE.md rule 14) — this used to be a hand-maintained local duplicate
// (the core schema's own doc comment named that as the debt); the two now
// share one definition, including the `unit` field. Cast bridges the zod
// major mismatch (core types against zod 4, this workspace types against
// zod 3); the runtime API used is identical.
export const BatchUpdateSchema =
  batchUpdateProductsSchema as unknown as z.ZodSchema<BatchUpdateProductsInput>;

// LIRA-149: `inventory:batch-delete` had NO Zod validation before this ticket
// — `ids` was trusted raw from the renderer, unlike its sibling
// `inventory:batch-update` above. The ids rule now lives in
// packages/core/src/validators/product.ts so the IPC handler and the REST
// route (`POST /api/inventory/products/batch-delete`) validate against ONE
// schema (rule 14) — REST wraps the same rule in `{ ids }` via
// `batchDeleteProductsSchema`. Cast bridges the zod major mismatch (core
// built against zod 4, this workspace against zod 3); the runtime API used
// is identical.
export const BatchDeleteProductIdsSchema =
  batchDeleteProductIdsSchema as unknown as z.ZodSchema<BatchDeleteProductIds>;

// The stock-adjustment contract lives in packages/core/src/validators/inventory.ts
// so the Electron IPC handler and the REST route validate against ONE schema
// (CLAUDE.md rule 14). Cast bridges the zod major mismatch (core types against
// zod 4, this workspace types against zod 3); the runtime API used is identical.
export const StockAdjustSchema =
  stockAdjustSchema as unknown as z.ZodSchema<StockAdjustInput>;

// Supplier stock intake: shared with the REST route and InventoryService.
// receiveStock (rule 14/19b). Cast bridges the zod major mismatch (core
// types against zod 4, this workspace types against zod 3); the runtime API
// used is identical.
export const ReceiveStockSchema =
  receiveStockSchema as unknown as z.ZodSchema<ReceiveStockInput>;

// LIRA-297: `item-costs:set` — shared with `POST /api/item-costs` (rule 14).
// Cast bridges the zod major mismatch, same as the schemas above.
export const SetItemCostSchema =
  setItemCostSchema as unknown as z.ZodSchema<SetItemCostInput>;

// The product-list filter contract lives in packages/core/src/validators/product.ts
// so the Electron IPC handler and the REST route validate against ONE schema
// (CLAUDE.md rule 14) — REST parses the query-string variant into this same
// shape. Cast bridges the zod major mismatch (core types against zod 4, this
// workspace types against zod 3); the runtime API used is identical.
export const ProductListFiltersSchema =
  productListFiltersSchema as unknown as z.ZodSchema<ProductListFilters>;

// =============================================================================
// Auth / Users
// =============================================================================

// These four re-export packages/core/src/validators/user.ts's schemas
// (rule 14/19b — one definition shared by IPC and REST) instead of a local
// duplicate. Names kept identical so every existing import in this file
// keeps working. Cast bridges the zod major mismatch (core types against
// zod 4, this workspace types against zod 3); the runtime API used is
// identical.
export const CreateUserSchema =
  coreCreateUserSchema as unknown as z.ZodSchema<CreateUserInput>;

export const SetPasswordSchema =
  coreSetUserPasswordSchema as unknown as z.ZodSchema<SetUserPasswordInput>;

export const SetUserActiveSchema =
  coreSetUserActiveSchema as unknown as z.ZodSchema<SetUserActiveInput>;

export const SetUserRoleSchema =
  coreSetUserRoleSchema as unknown as z.ZodSchema<SetUserRoleInput>;

export const ChangeOwnPasswordSchema =
  coreChangeOwnPasswordSchema as unknown as z.ZodSchema<ChangeOwnPasswordInput>;

export const SetMyLanguageSchema =
  coreSetMyLanguageSchema as unknown as z.ZodSchema<SetMyLanguageInput>;

// =============================================================================
// Expenses
// =============================================================================

// LIRA-306 T041 — the desktop now validates with core's `createExpenseSchema`
// (what POST /api/expenses already uses, and what preload.ts already types
// the payload as). Diff: `expense_type` was read nowhere; an empty description
// and a missing amount_lbp (→ 0) are now accepted as on the web (O-impl-4).
export const AddExpenseSchema =
  coreCreateExpenseSchema as unknown as z.ZodSchema<CreateExpenseInput>;

// LIRA-262 — core's schema, cast across the zod-major mismatch (core: zod 4,
// this workspace: zod 3; the runtime API used is identical). The output type
// is the parsed shape the service takes.
export const CreateStockExpenseSchema =
  createStockExpenseSchema as unknown as z.ZodSchema<CreateStockExpenseData>;

// =============================================================================
// Maintenance
// =============================================================================

// LIRA-185 D9 — this used to be a hand-maintained LOCAL duplicate of core's
// `saveMaintenanceJobSchema` (same rule-14 local-duplicate debt the
// kept_change_*/parts comments below used to warn about), and it never
// declared `paid_by`, `note` or `transaction_time` at all — so Zod silently
// stripped all three from every desktop save, even though
// `MaintenanceRepository.createJob`/`updateJob` read `job.paid_by`/`job.note`
// directly and `MaintenanceService.saveJob` validates/uses
// `params.transaction_time`. REST validates the real core schema and always
// kept them, so a backdated repair checkout silently did nothing on desktop
// while working on web. Re-exported straight from core via the same
// cast-bridge pattern as `GetMaintenanceStatusHistorySchema` below (core
// types against zod 4, this workspace against zod 3; the runtime API is
// identical).
//
// ONE deliberate deviation: core's `client_phone` is
// `z.string().optional()` (no `.nullable()`) and pipes through
// `optionalPhoneNumberSchema`'s format regex. Desktop's old local schema
// explicitly accepted `client_phone: null` (a caller signalling "no phone")
// and left it untouched with no format check at all
// (MaintenanceJobSchema.phoneNormalization.test.ts pins this). A bare `null`
// would now fail core's schema outright — a real desktop regression this
// swap must not introduce. Map `null` -> `undefined` before the real schema
// runs: both are nullish, and `MaintenanceRepository.createJob`/`updateJob`
// already read `job.client_phone ?? null`, so stored behavior (NULL in the
// DB either way) is unchanged — only the format-regex parity with REST is a
// deliberate, in-scope tightening (rule 19: desktop and web should agree).
//
// NOTE: this is deliberately NOT `z.preprocess(..., saveMaintenanceJobSchema)`
// — wrapping a zod-4 schema in THIS workspace's zod-3 combinators breaks at
// runtime (`this._def.schema._parseSync is not a function`: zod 3's
// ZodEffects reaches into the wrapped schema's zod-3-shaped internals, which
// zod 4 no longer has). A plain object that delegates straight to the real
// schema's own `.parse`/`.safeParse` (native zod-4 calls, the same ones the
// bare cast-bridge re-exports elsewhere in this file rely on) avoids that
// entirely.
function normalizeNullClientPhone(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    "client_phone" in raw &&
    (raw as Record<string, unknown>).client_phone === null
  ) {
    return { ...(raw as Record<string, unknown>), client_phone: undefined };
  }
  return raw;
}

export const MaintenanceJobSchema = {
  parse: (data: unknown) =>
    saveMaintenanceJobSchema.parse(normalizeNullClientPhone(data)),
  safeParse: (data: unknown) =>
    saveMaintenanceJobSchema.safeParse(normalizeNullClientPhone(data)),
} as unknown as z.ZodSchema<SaveMaintenanceJobInput>;

// LIRA-176 phase 4 — brand new, no local duplicate: re-exported straight
// from core via the same cast-bridge pattern as RechargeSchema above (core
// types against zod 4, this workspace against zod 3; the runtime API is
// identical).
export const GetMaintenanceStatusHistorySchema =
  getMaintenanceStatusHistorySchema as unknown as z.ZodSchema<GetMaintenanceStatusHistoryInput>;

// =============================================================================
// Recharge
// =============================================================================

// The recharge-processing contract lives in packages/core/src/validators/recharge.ts
// so the Electron IPC handler and REST /api/recharge/process validate against
// ONE schema (CLAUDE.md rules 14 + 19b — CARRIER_LINES_VALIDITY_PLAN.md Phase
// 6a). This file used to hold a LOCAL duplicate that was the only copy
// carrying `payments[]`, `clientName`, `default_price_to_client` and
// `ALFA_GIFT`; because `backend/src/middleware/validation.ts` reassigns
// `req.body = schema.parse(req.body)` and Zod strips unknown keys, every REST
// recharge silently lost its payment legs and fell into the repository's
// legacy single-method fallback. Re-exported under the historical local name.
// Cast bridges the zod major mismatch (core types against zod 4, this
// workspace types against zod 3); the runtime API used is identical.
export const RechargeSchema =
  createRechargeSchema as unknown as z.ZodSchema<CreateRechargeInput>;

// CARRIER_LINES_VALIDITY_PLAN.md Phase 8.4: the four remaining top-up arm
// contracts now live in packages/core/src/validators/recharge.ts (rules 14 +
// 19b), shared with the new REST routes in backend/src/api/recharge.ts. This
// file used to hold local duplicates for three of them (`topUpApp` had NO
// schema at all — closed here for the first time on both transports). Cast
// bridges the zod major mismatch (core types against zod 4, this workspace
// types against zod 3); the runtime API used is identical.
export const TopUpAppSchema =
  topUpAppSchema as unknown as z.ZodSchema<TopUpAppInput>;

export const TopUpFromSupplierSchema =
  topUpFromSupplierSchema as unknown as z.ZodSchema<TopUpFromSupplierInput>;

// OMT open-credit account (LIRA-192) — cashout is the mirror of
// topUpFromSupplier: OMT_App wallet down, OMT account credited
// principal + commission. Shared with the REST route
// (POST /api/recharge/cashout-to-supplier, backend/src/api/recharge.ts).
// Cast bridges the zod major mismatch (core types against zod 4, this
// workspace types against zod 3); the runtime API used is identical.
export const RechargeCashoutSchema =
  rechargeCashoutSchema as unknown as z.ZodSchema<RechargeCashoutInput>;

export const TopUpFromPartnerSchema =
  topUpFromPartnerSchema as unknown as z.ZodSchema<TopUpFromPartnerInput>;

export const TopUpFromClientSchema =
  topUpFromClientSchema as unknown as z.ZodSchema<TopUpFromClientInput>;

// LIRA-109: `recharge:update-metadata` had NO Zod validation at all before
// this ticket (a raw typed arg) — closing that gap on both transports at
// once, same pattern TopUpAppSchema used. Shared with the REST route
// (`PATCH /api/recharge/:id/metadata`, backend/src/api/recharge.ts).
export const UpdateRechargeMetadataSchema =
  updateRechargeMetadataSchema as unknown as z.ZodSchema<UpdateRechargeMetadataInput>;

// =============================================================================
// Financial Services (OMT / WHISH / BOB / iPick / Katsh / Binance)
// =============================================================================

// FinancialServiceSchema — LIRA-306 (rule 23 lift): the hand-written desktop
// copy that lived here (a duplicate of core `createFinancialServiceSchema`,
// with its own copies of the leg/provider fields and of every refine) is
// gone; `omt:add-transaction` now validates with the SAME core schema
// POST /api/services/transactions uses. Re-exported in the LIRA-306 Phase 6
// (Agent B) block at the end of this file. Key diff in
// packages/core/src/offline/bindings/__tests__/financial.test.ts.

// Self-charge (LIRA-090 §5.2 / Phase 5 of the carrier-lines-validity plan):
// shared by the IPC handler (`financial:self-charge-telecom-item`) and the
// REST route (`/api/services/self-charge`) per rule 14/19. Cast bridges the
// zod major mismatch (core built against zod 4, this workspace against
// zod 3) — the runtime API used is identical.
export const SelfChargeTelecomItemSchema =
  selfChargeTelecomItemSchema as unknown as z.ZodSchema<SelfChargeTelecomItemInput>;

// =============================================================================
// Exchange
// =============================================================================

// The full submit contract lives in packages/core/src/validators/exchange.ts
// (EXCHANGE_LOT_SETTLEMENT.md "Named follow-up" F3, rule 14 unification —
// lifted out of what used to be a LOCAL duplicate right here, the same
// rule-14 debt createExchangeSchema's own comments used to point at) so the
// IPC handler (`exchange:add-transaction`) and the REST route
// (`POST /api/exchange/transactions`) validate against ONE schema, both
// landing on `ExchangeService.addDirectTransaction`. Cast bridges the zod
// major mismatch (core built against zod 4, this workspace against zod 3);
// the runtime API used is identical. Exported under the historical local
// name — exchangeHandlers.ts imports `ExchangeTransactionSchema` and needs
// no change.
export const ExchangeTransactionSchema =
  exchangeSubmitSchema as unknown as z.ZodSchema<ExchangeSubmitInput>;

// The update-metadata contract lives in
// packages/core/src/validators/exchange.ts (EXCHANGE_LOT_SETTLEMENT.md
// Phase 6, rule 14/19 cleanup — lifted out of a LOCAL duplicate this file and
// backend/src/api/exchange.ts each used to carry) so the IPC handler
// (exchange:update-metadata) and the REST route validate against ONE schema.
// Cast bridges the zod major mismatch (core built against zod 4, this
// workspace against zod 3); the runtime API used is identical.
export const UpdateExchangeMetadataSchema =
  updateExchangeMetadataSchema as unknown as z.ZodSchema<UpdateExchangeMetadataInput>;

// =============================================================================
// Loto
// =============================================================================

// Loto contracts live in packages/core/src/validators/loto.ts so the IPC
// handlers and the REST routes (backend/src/api/loto.ts) validate against ONE
// schema each (CLAUDE.md rule 14). Casts bridge the zod major mismatch (core
// types against zod 4, this workspace against zod 3); runtime API identical.
export const LotoSellSchema =
  lotoSellSchema as unknown as z.ZodSchema<LotoSellInput>;
export const LotoCashPrizeSchema =
  lotoCashPrizeSchema as unknown as z.ZodSchema<LotoCashPrizeInput>;
export const LotoTicketUpdateSchema =
  lotoTicketUpdateSchema as unknown as z.ZodSchema<LotoTicketUpdateInput>;
export const LotoFeeSchema =
  lotoFeeSchema as unknown as z.ZodSchema<LotoFeeInput>;
export const LotoCheckpointCreateSchema =
  lotoCheckpointCreateSchema as unknown as z.ZodSchema<LotoCheckpointCreateInput>;
// Closes the one checkpoint write path with no schema before this ticket —
// see lotoCheckpointUpdateSchema's doc comment (packages/core/src/validators/
// loto.ts) for the strip-trap this guards against.
export const LotoCheckpointUpdateSchema =
  lotoCheckpointUpdateSchema as unknown as z.ZodSchema<LotoCheckpointUpdateInput>;
export const LotoCheckpointSettleSchema =
  lotoCheckpointSettleSchema as unknown as z.ZodSchema<LotoCheckpointSettleInput>;
export const LotoCheckpointsSettleBatchSchema =
  lotoCheckpointsSettleBatchSchema as unknown as z.ZodSchema<LotoCheckpointsSettleBatchInput>;

/** Bare positive-integer id (transactions:void/refund, loto:update). */
export const PositiveIdSchema = z.number().int().positive();

// The group-void contract lives in packages/core/src/validators/transaction.ts
// so the Electron IPC handler and the REST route validate against ONE schema
// (CLAUDE.md rule 14). CARRIER_LEGS_VOID_ASYMMETRY.md (design B+).
export const VoidCheckoutGroupSchema =
  voidCheckoutGroupSchema as unknown as z.ZodSchema<VoidCheckoutGroupInput>;

// LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C) — the session-basket
// whole-void/refund contract, same shared-schema shape as
// VoidCheckoutGroupSchema immediately above (rule 14).
export const SessionBasketReversalSchema =
  sessionBasketReversalSchema as unknown as z.ZodSchema<SessionBasketReversalInput>;

// LIRA-078: operator-chosen refund return legs (method override). Shared with
// the REST route the same way — packages/core/src/validators/transaction.ts,
// rule 14. Validated only when present — a plain refund (no legs) never
// reaches this schema.
export const RefundLegsSchema =
  refundLegsSchema as unknown as z.ZodSchema<RefundLegsInput>;

// LIRA-143 phase 5: the phone-refund UI's per-unit defective/warranty-
// override flags, riding alongside `refundLegs` on the SAME
// `transactions:refund` call. Shared with the REST route the same way —
// packages/core/src/validators/transaction.ts, rule 14. Validated only when
// present — a plain refund (no extras) never reaches this schema.
export const RefundUnitExtrasSchema =
  refundUnitExtrasSchema as unknown as z.ZodSchema<RefundUnitExtrasInput>;

// LIRA-236 — the cashier-typed exchange rate, riding alongside `refundLegs`
// on the SAME `transactions:refund` call (the ONLY refund channel that
// validates it as a bare positional value rather than a key on a combined
// object schema — every other refund payload embeds `exchangeRate` directly).
// Shared with the REST route the same way, rule 14. Validated only when
// present — a plain refund (no typed rate) never reaches this schema.
export const RefundExchangeRateSchema =
  refundExchangeRateSchema as unknown as z.ZodSchema<number | undefined>;

// Owner decision 2026-10-07 — refund kept change, riding alongside
// `refundLegs` on the SAME `transactions:refund` call (fifth positional
// argument). Shared with the REST route's `keptChange` body key, rule 14.
// Validated only when present; the repository checks the claim itself.
export const RefundKeptChangeSchema =
  refundKeptChangeSchema as unknown as z.ZodSchema<RefundKeptChangeInput>;

// LIRA-232 phase 2 (SESSION_ITEM_REFUND_PLAN.md §7) — refund ONE (or, with
// saleItemId omitted on a SALE member, every remaining) line of a
// customer-session basket item. Shared with the REST route the same way —
// packages/core/src/validators/transaction.ts, rule 14. Same cast-bridge
// pattern as its siblings above.
export const SessionItemRefundSchema =
  sessionItemRefundSchema as unknown as z.ZodSchema<SessionItemRefundInput>;

// Read-only preview counterpart of SessionItemRefundSchema above — mirrors
// SaleRefundPreviewSchema's (LIRA-231) role for the whole-sale/item refund
// preview. Same cast-bridge pattern.
export const SessionItemRefundPreviewSchema =
  sessionItemRefundPreviewSchema as unknown as z.ZodSchema<SessionItemRefundPreviewInput>;

// =============================================================================
// Carrier Lines (LIRA W6.a) / Mobile Service Items (LIRA W6.b)
// =============================================================================

// Shared contracts live in packages/core/src/validators/carrierLine.ts and
// mobileServiceItem.ts so the IPC handler and the REST route validate
// against ONE schema (CLAUDE.md rule 14/19). Casts bridge the zod major
// mismatch (core built against zod 4, this workspace against zod 3) — the
// runtime API used is identical.
export const CarrierLineCreateSchema =
  carrierLineCreateSchema as unknown as z.ZodSchema<CarrierLineCreateInput>;
export const CarrierLineUpdateSchema =
  carrierLineUpdateSchema as unknown as z.ZodSchema<CarrierLineUpdateInput>;
export const CarrierLineUpdateBalanceSchema =
  carrierLineUpdateBalanceSchema as unknown as z.ZodSchema<CarrierLineUpdateBalanceInput>;
// LIRA-145: record CONSUMPTION of a line's credits as a `Line_Usage` expense.
// Deliberately thin — every delta/ordering rule (line exists, line is active,
// `newCredits` below the stored balance by the $0.01 epsilon,
// `expectedCurrentCredits` still matching) is a SERVER fact enforced inside
// `CarrierLineRepository.recordUsage`'s db transaction, not duplicated here
// (rule 14). Same cast bridge as its siblings above.
export const RecordCarrierLineUsageSchema =
  recordCarrierLineUsageSchema as unknown as z.ZodSchema<RecordCarrierLineUsageInput>;
// v184 (#28, LIRA-218) — "days still to send" Mark Sent. Same cast bridge.
export const MarkCarrierLineOwedDeliverySentSchema =
  markCarrierLineOwedDeliverySentSchema as unknown as z.ZodSchema<MarkCarrierLineOwedDeliverySentInput>;
export const MobileServiceItemUpdateSchema =
  mobileServiceItemUpdateSchema as unknown as z.ZodSchema<MobileServiceItemUpdateInput>;
// LIRA-090: create path now has a schema (none existed before this ticket).
// The cast bridges the zod major mismatch (core against zod 4, this workspace
// against zod 3) — runtime API is identical.
export const MobileServiceItemCreateSchema =
  mobileServiceItemCreateSchema as unknown as z.ZodSchema<MobileServiceItemCreateInput>;
// TELECOM_DAYS_COST_PLAN.md follow-up: the seed path (fresh-install catalog
// bulk-insert) had ZERO validation before this ticket — `mobileServiceItem.ts`'s
// own header comment names this as a pre-existing gap.
//
// NOTE the array is built in CORE (`mobileServiceItemSeedSchema`) and cast
// here as a whole. Do NOT "simplify" this to
// `z.array(MobileServiceItemCreateSchema)`: that wraps an ALREADY-CAST core
// schema in THIS workspace's zod, so the element parser and the array parser
// come from different zod majors and every parse dies with
// `def.type._parseSync is not a function`. It shipped exactly that way and the
// lira-132 e2e caught it — the seed failed on every fresh install, silently,
// because MobileServiceItemsContext.load() swallows the error and the operator
// just sees an empty telecom catalog. Cast the finished validator, never a
// part of one.
export const MobileServiceItemSeedSchema =
  mobileServiceItemSeedSchema as unknown as z.ZodSchema<
    MobileServiceItemCreateInput[]
  >;

// =============================================================================
// Custom Services
// =============================================================================

// `CustomServiceCreateSchema` is the core `createCustomServiceSchema` (LIRA-306
// rule 23 lift) — re-exported in the Agent C custom-services/loto block at
// the END of this file. The hand-written local duplicate it replaced carried
// the same key set but neither the core refines nor its length caps.

// LIRA-155 — advance an existing custom service's fulfilment status
// (ORDERED -> ISSUED -> RECEIVED -> DELIVERED). Lifted from
// packages/core/src/validators/customService.ts (rule 14) rather than
// hand-duplicated (as CustomServiceCreateSchema once was) — this is a brand
// new schema with no pre-existing local copy, so casting the shared
// definition (same pattern as HoldMoneyCreateSchema) is the correct choice,
// not the trap. The cast bridges the zod-major mismatch between this
// workspace's zod and core's; runtime shape is identical.
export const CustomServiceUpdateFulfillmentSchema =
  updateCustomServiceFulfillmentSchema as unknown as z.ZodSchema<UpdateCustomServiceFulfillmentInput>;

// LIRA-083 — set an existing custom service's WORK status (migration v190's
// work_status column: Received -> In_Progress -> Ready -> Delivered, no
// transition-legality check — see packages/core/src/utils/
// customServiceWorkStatus.ts). Same lift-and-cast pattern as
// CustomServiceUpdateFulfillmentSchema above (rule 14).
export const CustomServiceUpdateWorkStatusSchema =
  updateCustomServiceWorkStatusSchema as unknown as z.ZodSchema<UpdateCustomServiceWorkStatusInput>;

// =============================================================================
// Hold Money
// =============================================================================

// Lifted to packages/core/src/validators/holdMoney.ts so the IPC handler and
// the REST route validate against ONE schema (rule 14). Cast bridges the
// zod-major mismatch (core=zod4, this workspace=zod3); runtime API identical.
export const HoldMoneyCreateSchema =
  holdMoneyCreateSchema as unknown as z.ZodSchema<HoldMoneyCreateInput>;

// LIRA-214 (migration v183) — pickup (collect) and pickup-void, same
// lift-and-cast pattern as HoldMoneyCreateSchema above (rule 14).
export const HoldMoneyCollectSchema =
  holdMoneyCollectSchema as unknown as z.ZodSchema<HoldMoneyCollectInput>;
export const HoldMoneyVoidPickupSchema =
  holdMoneyVoidPickupSchema as unknown as z.ZodSchema<HoldMoneyVoidPickupInput>;

// =============================================================================
// Drawer Top-Up
// =============================================================================

// LIRA-297 — both drawer top-up contracts now live in
// packages/core/src/validators/drawerTopUp.ts so `POST /api/drawer-topup` and
// `POST /api/drawer-topup/from-drawer` validate against the SAME schemas as
// the two IPC channels (rule 14). `DrawerTopUpCreateSchema` was lifted
// verbatim (keys, `.default(0)`s, refines and messages unchanged). The cast
// pins T to the schema's OUTPUT type (`z.infer`: amount_usd/lbp are plain
// numbers after `.default(0)`), which is what `svc.addTopUp(validation.data,
// …)` needs — the zod-major bridge used throughout this file.
//
// `DrawerTopUpFromDrawerSchema` is new (the from-drawer channel validated
// nothing before): keys are the union both transports forwarded
// (amount_usd, amount_lbp, source_drawer, notes, transaction_time), so
// nothing that reached the service before is stripped now (rule 23).
export type { DrawerTopUpCreateInput, DrawerTopUpFromDrawerInput };
export const DrawerTopUpCreateSchema =
  drawerTopUpCreateSchema as unknown as z.ZodSchema<DrawerTopUpCreateInput>;
export const DrawerTopUpFromDrawerSchema =
  drawerTopUpFromDrawerSchema as unknown as z.ZodSchema<DrawerTopUpFromDrawerInput>;

// =============================================================================
// Currencies + Payment Methods (Settings CRUD)
// =============================================================================

// LIRA-297 — written once in packages/core/src/validators/{currency,
// paymentMethod}.ts and shared with the REST twins (rule 14). Keys are
// exactly what the repositories read, so nothing either channel forwarded
// before is stripped (rule 23). The currency UPDATE schema covers the fields
// only: `currencies:update` destructures `id` off its payload first.
export const CurrencyCreateSchema =
  createCurrencySchema as unknown as z.ZodSchema<CreateCurrencyInput>;
export const CurrencyUpdateSchema =
  updateCurrencySchema as unknown as z.ZodSchema<UpdateCurrencyInput>;
export const PaymentMethodCreateSchema =
  createPaymentMethodSchema as unknown as z.ZodSchema<CreatePaymentMethodInput>;
export const PaymentMethodUpdateSchema =
  updatePaymentMethodSchema as unknown as z.ZodSchema<UpdatePaymentMethodInput>;

// =============================================================================
// Drawer Cash-Out
// =============================================================================

// The cash-out contract lives in packages/core/src/validators/drawerCashout.ts
// so the Electron IPC handler and the REST route (when added) validate against
// ONE schema (CLAUDE.md rule 14). Cast bridges the zod major mismatch (core
// types against zod 4, this workspace against zod 3); the runtime API used is
// identical.
export const DrawerCashoutSchema =
  createDrawerCashoutSchema as unknown as z.ZodSchema<CreateDrawerCashoutInput>;

// =============================================================================
// Wallet Exchange
// =============================================================================

// The wallet-exchange contract lives in
// packages/core/src/validators/walletExchange.ts so the Electron IPC handler
// and the REST route validate against ONE schema (CLAUDE.md rule 14).
export const WalletExchangeSchema =
  createWalletExchangeSchema as unknown as z.ZodSchema<CreateWalletExchangeInput>;

// =============================================================================
// Drawer Transfer (General <-> primary cash drawer, Primary Cash Drawer plan §8.6)
// =============================================================================

// The drawer-transfer contract lives in
// packages/core/src/validators/drawerTransfer.ts (replacing the retired
// systemFloatTopup.ts) so the Electron IPC handler and the REST route
// validate against ONE schema (CLAUDE.md rule 14). Cast bridges the zod-major
// mismatch (core=zod4, this workspace=zod3); runtime API used is identical.
export const DrawerTransferSchema =
  createDrawerTransferSchema as unknown as z.ZodSchema<CreateDrawerTransferInput>;

// =============================================================================
// Debt Repayment
// =============================================================================

// CQ-8: the local DebtRepaymentSchema duplicate (documented rule-14 debt) is
// gone — re-exports packages/core/src/validators/debt.ts's addRepaymentSchema
// so the IPC handler and the REST route validate against ONE schema. This
// closed a real drift, not just a documented one: core's repaymentPaymentLine
// leg schema was missing `direction` (IN/OUT, used for change-return legs),
// so the REST repayment route was silently stripping it off every leg —
// fixed in debt.ts itself, which fixes both transports at once. Cast bridges
// the zod-major mismatch (core=zod4, this workspace=zod3); runtime API
// identical.
export const DebtRepaymentSchema =
  addRepaymentSchema as unknown as z.ZodSchema<AddRepaymentInput>;

// Lifted to packages/core/src/validators/debt.ts so the IPC handler and the
// REST route validate against ONE schema (rule 14). Casts bridge the zod-major
// mismatch (core=zod4, this workspace=zod3); runtime API identical.
export const DebtCashOutSchema =
  debtCashOutSchema as unknown as z.ZodSchema<DebtCashOutInput>;
export const DebtAccountEntrySchema =
  debtAccountEntrySchema as unknown as z.ZodSchema<DebtAccountEntryInput>;

// DebtAddCreditSchema — LIRA-306: lifted to core `addCreditSchema` (the
// schema POST /api/debts/credit validates with); re-exported in the
// LIRA-306 Phase 6 (Agent B) block at the end of this file.

// CQ-9 (rule 14): lifted to packages/core/src/validators/debt.ts so the IPC
// handler (debt:use-credit) and the new REST route (POST
// /api/debts/use-credit) validate against ONE schema. Cast bridges the
// zod-major mismatch (core=zod4, this workspace=zod3); runtime API and field
// names/laxity are unchanged (byte-for-byte lift of the local schema this
// replaces).
export const DebtUseCreditSchema =
  debtUseCreditSchema as unknown as z.ZodSchema<DebtUseCreditInput>;

// LIRA-347 — one month of a client's debt items (settle calendar read).
// Same core schema as GET /api/debts/clients/:clientId/month-rows (rule 14).
export const DebtMonthRowsSchema =
  debtMonthRowsSchema as unknown as z.ZodSchema<DebtMonthRowsInput>;

// CQ-10 (D4: admin-only on both transports) — standalone debt write-off.
// Lifted to packages/core/src/validators/debt.ts so the IPC handler
// (debt:write-off) and the REST route (POST /api/debts/write-off) validate
// against ONE schema (rule 14). Cast bridges the zod-major mismatch.
export const DebtWriteOffSchema =
  debtWriteOffSchema as unknown as z.ZodSchema<DebtWriteOffInput>;

// =============================================================================
// Clients
// =============================================================================

// LIRA-306 T041 — lifted VERBATIM to core's `clientWriteSchema` (rule 23
// three-way diff in packages/core/src/validators/__tests__/offlineLift.us1.test.ts)
// so this handler, the offline recorder and the replay binding share one
// object. Same zod-major cast bridge as the schemas above.
export const ClientCreateSchema =
  coreClientWriteSchema as unknown as z.ZodSchema<ClientWriteInput>;

// =============================================================================
// Suppliers
// =============================================================================

// LIRA-297 — lifted verbatim to core's `supplierCreateSchema` so
// `POST /api/suppliers` (which used to check `name` by hand) validates
// against the same schema as `suppliers:create`. Same cast-bridge pattern as
// the supplier schemas below.
export const SupplierCreateSchema =
  supplierCreateSchema as unknown as z.ZodSchema<SupplierCreateInput>;

// CQ-8 (rule 14): lifted to packages/core/src/validators/supplier.ts so the
// IPC handlers (supplierHandlers.ts) and any REST route validate against ONE
// schema each. Casts bridge the zod-major mismatch (core=zod4, this
// workspace=zod3); runtime API identical. Field names unchanged.
export const SupplierLedgerEntrySchema =
  supplierLedgerEntrySchema as unknown as z.ZodSchema<SupplierLedgerEntryInput>;
export const SupplierSettleSchema =
  supplierSettleSchema as unknown as z.ZodSchema<SupplierSettleInput>;
// OMT open-credit account settlement (LIRA-189, CONTRACT_W2.md §2.1) —
// consumed by supplierHandlers.ts's `suppliers:settle-account` IPC channel.
export const SupplierSettleAccountSchema =
  supplierSettleAccountSchema as unknown as z.ZodSchema<SupplierSettleAccountInput>;
// LIRA-344 — Remove credit on the OMT account (`suppliers:remove-account-credit`).
export const RemoveAccountCreditSchema =
  removeAccountCreditSchema as unknown as z.ZodSchema<RemoveAccountCreditInput>;
// LIRA-256 — which OMT commission types a statement covers; parsed for the
// `suppliers:account-expected-statement` read's optional 2nd argument.
export const OmtCoveredTypesSchema =
  omtCoveredTypesSchema as unknown as z.ZodSchema<OmtCoveredTypesInput>;
// LIRA-343 — the calendar's month read (`suppliers:account-month-rows`).
export const AccountMonthSchema =
  accountMonthSchema as unknown as z.ZodSchema<AccountMonthInput>;
// LIRA-343 — one shop day's details (`suppliers:account-day-detail`).
export const AccountDaySchema =
  accountDaySchema as unknown as z.ZodSchema<AccountDayInput>;
// 2026-10-27 — the statement check's params (`suppliers:account-expected-statement`).
export const AccountExpectedStatementParamsSchema =
  accountExpectedStatementParamsSchema as unknown as z.ZodSchema<AccountExpectedStatementParamsInput>;
// LIRA-343 T033a — the supplier Transactions window's optional shop-day
// range (`suppliers:all-transactions` / `:account-transactions` /
// `:account-ledger`, optional last argument).
export const SupplierDayRangeSchema =
  supplierDayRangeSchema as unknown as z.ZodSchema<SupplierDayRangeInput>;
export const SupplierCashflowSchema =
  supplierCashflowSchema as unknown as z.ZodSchema<SupplierCashflowInput>;
export const SupplierPurchaseCreateSchema =
  supplierPurchaseCreateSchema as unknown as z.ZodSchema<SupplierPurchaseCreateInput>;
// LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — consumed by
// supplierHandlers.ts's `suppliers:update-account-link` IPC channel.
export const SupplierAccountLinkSchema =
  supplierAccountLinkSchema as unknown as z.ZodSchema<SupplierAccountLinkInput>;
// LIRA-087 (migration v189) — consumed by supplierHandlers.ts's
// `suppliers:record-debt` IPC channel.
export const SupplierRecordDebtSchema =
  supplierRecordDebtSchema as unknown as z.ZodSchema<SupplierRecordDebtInput>;

// NOTE: the standalone supplier write-off (CQ-10) was REMOVED (owner decision
// D8, SUPPLIER_STOCK_INTAKE_PLAN.md) — SupplierWriteOffSchema/
// supplierWriteOffSchema/SupplierService.writeOffSupplierDebt no longer
// exist. The bundled Pay-form discount (recordSupplierCashflow's `discount`
// field) is the surviving forgiveness path.

// =============================================================================
// Vouchers (Gift Cards)
// =============================================================================

// The voucher-create contract lives in packages/core/src/validators/voucher.ts
// so the Electron IPC handler and the REST route validate against ONE schema
// (CLAUDE.md rule 14). Re-exported under the historical local name.
export const VoucherCreateSchema =
  voucherCreateSchema as unknown as z.ZodSchema<VoucherCreateInput>;

// LIRA-339 — `voucher:cancel(id, data?)` refund payload, shared with
// `POST /api/vouchers/:id/cancel`.
export const VoucherCancelSchema =
  voucherCancelSchema as unknown as z.ZodSchema<VoucherCancelInput>;

// =============================================================================
// Customer Sessions — basket checkout
// =============================================================================

// The session checkout contract lives in packages/core/src/validators/session.ts
// so the IPC handler and the REST route validate against ONE schema (rule 14).
// Cast bridges the zod major mismatch (core types against zod 4, this workspace
// against zod 3); the runtime API is identical.
export const SessionCheckoutSchema =
  sessionCheckoutSchema as unknown as z.ZodSchema<SessionCheckoutInput>;

// LIRA-326 — Mobile Recharge basket checkout: the session checkout envelope
// minus sessionId (the core service creates the session), plus clientPhone.
// One core contract shared with POST /api/recharge-basket/checkout (rule 14);
// cast bridges the zod major mismatch, same as SessionCheckoutSchema above.
export const RechargeBasketCheckoutSchema =
  rechargeBasketCheckoutSchema as unknown as z.ZodSchema<RechargeBasketCheckoutInput>;
// LIRA-327 — the basket-wide For Partner submit (every provider's partner
// sales, all-or-nothing). One core contract shared with
// POST /api/recharge-basket/partner-order (rule 14).
export const RechargePartnerOrderSchema =
  rechargePartnerOrderSchema as unknown as z.ZodSchema<RechargePartnerOrderInput>;

// LIRA-297 item 3 — the non-checkout session writes, the daily-closing edit
// and voucher-image save, each shared with its REST twin via
// packages/core/src/validators/{session,closing,voucherImage}.ts (rule 14).
// Every schema covers the full key set its handler forwards (rule 23). Casts
// bridge the zod major mismatch, same as SessionCheckoutSchema above.
export const StartSessionIpcSchema =
  startSessionIpcSchema as unknown as z.ZodSchema<StartSessionIpcInput>;
export const UpdateSessionSchema =
  updateSessionSchema as unknown as z.ZodSchema<UpdateSessionInput>;
export const SessionCartAddSchema =
  sessionCartAddSchema as unknown as z.ZodSchema<SessionCartAddInput>;
export const LinkSessionTransactionSchema =
  linkSessionTransactionSchema as unknown as z.ZodSchema<LinkSessionTransactionInput>;
export const UpdateDailyClosingIpcSchema =
  updateDailyClosingIpcSchema as unknown as z.ZodSchema<UpdateDailyClosingIpcInput>;
export const SetVoucherImageSchema =
  setVoucherImageSchema as unknown as z.ZodSchema<SetVoucherImageInput>;

// =============================================================================
// Partners
// =============================================================================

// CQ-8 (rule 14): partner IPC handlers had zero Zod validation before this —
// re-exports packages/core/src/validators/partner.ts's schemas (the FULL
// transaction_type union, already used by backend/src/api/partners.ts) so the
// IPC handlers (partnerHandlers.ts) validate the same shape the REST route
// does. Cast bridges the zod-major mismatch (core=zod4, this workspace=zod3);
// runtime API identical.
export const PartnerRecordTransactionSchema =
  partnerRecordTransactionSchema as unknown as z.ZodSchema<PartnerRecordTransactionInput>;
export const PartnerSettleSchema =
  partnerSettleSchema as unknown as z.ZodSchema<PartnerSettleInput>;

// CQ-10 (D4: admin-only on both transports) — standalone partner write-off.
// Lifted to packages/core/src/validators/partner.ts so the IPC handler
// (partners:write-off) and the REST route (POST /api/partners/write-off)
// validate against ONE schema (rule 14). Cast bridges the zod-major mismatch.
export const PartnerWriteOffSchema =
  partnerWriteOffSchema as unknown as z.ZodSchema<PartnerWriteOffInput>;

// LIRA-346 — settle partners by day: the write and the two calendar reads
// share core's schemas with the REST routes (rule 14). Cast bridges zod.
export const PartnerSettleDaysSchema =
  partnerSettleDaysSchema as unknown as z.ZodSchema<PartnerSettleDaysInput>;
export const PartnerMonthRowsSchema =
  partnerMonthRowsSchema as unknown as z.ZodSchema<PartnerMonthRowsInput>;
export const PartnerDayDetailSchema =
  partnerDayDetailSchema as unknown as z.ZodSchema<PartnerDayDetailInput>;

// =============================================================================
// Service Providers (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 5)
// =============================================================================

// The service-provider write-path contract lives in
// packages/core/src/validators/serviceProvider.ts so the Electron IPC
// handlers (serviceProviderHandlers.ts) and the REST routes
// (backend/src/api/serviceProviders.ts) validate against ONE schema (rule
// 14). Cast bridges the zod-major mismatch (core=zod4, this workspace=zod3);
// runtime API used is identical. Note what's absent: neither schema accepts
// `drawer_name`/`is_system_provider` — see the core schema's own doc comment
// for the money-safety reason (a new provider always settles to `General`).
export const CreateServiceProviderSchema =
  createServiceProviderSchema as unknown as z.ZodSchema<CreateServiceProviderInput>;
export const UpdateServiceProviderSchema =
  updateServiceProviderSchema as unknown as z.ZodSchema<UpdateServiceProviderInput>;

// =============================================================================
// Exchange Lots (EXCHANGE_LOT_SETTLEMENT.md Phase 4a)
// =============================================================================

// The exchange-lot contracts live in packages/core/src/validators/exchangeLot.ts
// so the Electron IPC handlers (exchangeLotHandlers.ts) and the REST routes
// (backend/src/api/exchangeLots.ts) validate against ONE schema each (rule
// 14). Casts bridge the zod-major mismatch (core=zod4, this workspace=zod3);
// runtime API used is identical.
export const PreviewLotSettlementSchema =
  previewLotSettlementSchema as unknown as z.ZodSchema<PreviewLotSettlementInput>;
export const LotBreakdownSchema =
  lotBreakdownSchema as unknown as z.ZodSchema<LotBreakdownInput>;
export const AdjustLotPositionSchema =
  adjustLotPositionSchema as unknown as z.ZodSchema<AdjustLotPositionInput>;

// =============================================================================
// Resale lines (LIRA-309 — phone lines the shop holds for sale)
// =============================================================================

// Shared with backend/src/api/resaleLines.ts (rule 14). Same zod-major cast
// as every other core schema re-exported here.
export const ListResaleLinesQuerySchema =
  listResaleLinesQuerySchema as unknown as z.ZodSchema<ListResaleLinesQuery>;
export const SaveResaleLineSchema =
  saveResaleLineSchema as unknown as z.ZodSchema<SaveResaleLineData>;
export const WriteOffResaleLineSchema =
  writeOffResaleLineSchema as unknown as z.ZodSchema<WriteOffResaleLineData>;
export const RechargeResaleLineSchema =
  rechargeResaleLineSchema as unknown as z.ZodSchema<RechargeResaleLineData>;
// LIRA-337 — give part of a line's credit back to a shop line.
export const GiveBackResaleLineSchema =
  giveBackResaleLineSchema as unknown as z.ZodSchema<GiveBackResaleLineData>;

// =============================================================================
// Wrong-number cards (LIRA-312)
// =============================================================================

// Shared with backend/src/api/wrongNumbers.ts (rule 14).
export const ListWrongNumbersQuerySchema =
  listWrongNumbersQuerySchema as unknown as z.ZodSchema<ListWrongNumbersQuery>;
export const RecordWrongNumberSchema =
  recordWrongNumberSchema as unknown as z.ZodSchema<RecordWrongNumberData>;
export const WrongNumberCreditsSchema =
  wrongNumberCreditsSchema as unknown as z.ZodSchema<WrongNumberCreditsData>;
export const WrongNumberSaleCardQuerySchema =
  wrongNumberSaleCardQuerySchema as unknown as z.ZodSchema<WrongNumberSaleCardQuery>;

// =============================================================================
// Product Units (LIRA-143 phase 5 — phone IMEI units & warranty)
// =============================================================================

// The product-unit contracts live in packages/core/src/validators/
// productUnit.ts so the Electron IPC handlers
// (electron-app/handlers/productUnitHandlers.ts + the
// inventory:resolve-scan-code/update-category handlers in
// inventoryHandlers.ts) and the REST routes (backend/src/api/productUnits.ts
// + the category/resolve-scan routes in backend/src/api/inventory.ts)
// validate against ONE schema each (rule 14). Casts bridge the zod-major
// mismatch (core=zod4, this workspace=zod3); runtime API used is identical.
export const RegisterProductUnitsSchema =
  registerProductUnitsSchema as unknown as z.ZodSchema<RegisterProductUnitsInput>;
export const ProductUnitsForProductSchema =
  productUnitsForProductSchema as unknown as z.ZodSchema<ProductUnitsForProductInput>;
export const ListProductUnitsSchema =
  listProductUnitsSchema as unknown as z.ZodSchema<ListProductUnitsInput>;
export const ProductUnitsSummarySchema =
  productUnitsSummarySchema as unknown as z.ZodSchema<ProductUnitsSummaryInput>;
export const ProductUnitIdSchema =
  productUnitIdSchema as unknown as z.ZodSchema<ProductUnitIdInput>;
export const UnitStoryQuerySchema =
  unitStoryQuerySchema as unknown as z.ZodSchema<UnitStoryQueryInput>;
export const UnitsForSaleItemsSchema =
  unitsForSaleItemsSchema as unknown as z.ZodSchema<UnitsForSaleItemsInput>;
export const ResolveScanCodeSchema =
  resolveScanCodeSchema as unknown as z.ZodSchema<ResolveScanCodeInput>;
export const CreateCategorySchema =
  createCategorySchema as unknown as z.ZodSchema<CreateCategoryInput>;
export const UpdateCategorySchema =
  updateCategorySchema as unknown as z.ZodSchema<UpdateCategoryInput>;

// =============================================================================
// Warranty (LIRA-296) — shared with backend/src/api/warranty.ts (rule 14)
// =============================================================================

export const WarrantySearchSchema =
  warrantySearchSchema as unknown as z.ZodSchema<WarrantySearchQuery>;
export const CreateWarrantyClaimSchema =
  createWarrantyClaimSchema as unknown as z.ZodSchema<CreateWarrantyClaimData>;
export const WarrantyClaimsForSchema =
  warrantyClaimsForSchema as unknown as z.ZodSchema<WarrantyClaimsForInput>;
export const VoidWarrantyClaimSchema =
  voidWarrantyClaimSchema as unknown as z.ZodSchema<VoidWarrantyClaimInput>;
export const ListDefectiveItemsSchema =
  listDefectiveItemsSchema as unknown as z.ZodSchema<ListDefectiveItemsInput>;
export const ResolveDefectiveSchema =
  resolveDefectiveSchema as unknown as z.ZodSchema<ResolveDefectiveInput>;
// P3 — supplier returns and the warranty report.
export const CreateSupplierReturnSchema =
  createSupplierReturnSchema as unknown as z.ZodSchema<CreateSupplierReturnInput>;
export const CloseSupplierReturnSchema =
  closeSupplierReturnSchema as unknown as z.ZodSchema<CloseSupplierReturnInput>;
export const ListSupplierReturnsSchema =
  listSupplierReturnsSchema as unknown as z.ZodSchema<ListSupplierReturnsInput>;
export const WarrantyReportSchema =
  warrantyReportSchema as unknown as z.ZodSchema<WarrantyReportInput>;

// =============================================================================
// Profits password gate (frozen contract)
// =============================================================================

// Both schemas live in packages/core/src/validators/profits.ts so the IPC
// handlers (profitHandlers.ts) and the REST routes (backend/src/api/profits.ts)
// validate against ONE schema each (rule 14). Casts bridge the zod-major
// mismatch (core=zod4, this workspace=zod3); runtime API used is identical.
export const SetProfitsPasswordSchema =
  coreSetProfitsPasswordSchema as unknown as z.ZodSchema<SetProfitsPasswordInput>;
export const UnlockProfitsSchema =
  coreUnlockProfitsSchema as unknown as z.ZodSchema<UnlockProfitsInput>;

// =============================================================================
// Database Reset (LIRA-165 — Settings > Reset Data)
// =============================================================================

// The contract lives in packages/core/src/validators/databaseReset.ts so the
// Electron IPC handler (databaseResetHandlers.ts) and the REST route
// (backend/src/api/databaseReset.ts, Phase 3) validate against ONE schema
// (rule 14). Cast bridges the zod-major mismatch (core=zod4, this
// workspace=zod3); runtime API used is identical. No named input type is
// part of the frozen Phase-1 contract, so the shape is spelled out inline
// rather than guessing a core export name.
export const DatabaseResetSchema =
  databaseResetSchema as unknown as z.ZodSchema<{ confirmation: string }>;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Validate payload against a Zod schema.
 * Returns `{ success: false, error: string }` on failure so handlers can
 * return a structured error to the renderer without throwing.
 */
export function validatePayload<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Validation failed: ${messages}` };
  }
  return { ok: true, data: result.data };
}

// =============================================================================
// "Edit metadata" channels (TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3)
// =============================================================================

// Five IPC handlers — sales:update-metadata, expenses:update-metadata,
// financial:update-metadata, custom-services:update-metadata,
// loto:update-metadata — validated nothing beyond `requireRole`, while the
// REST routes added in the same sweep already validate against these core
// schemas (packages/core/src/validators/{sale,expense,financial,
// customService,loto}.ts). That made REST silently STRICTER than desktop —
// e.g. a 600-character note saved on desktop and was refused on web. Lifting
// the IPC handlers onto the SAME schemas closes that gap (rule 14/19b). Casts
// bridge the zod-major mismatch (core built against zod 4, this workspace
// against zod 3); the runtime API used is identical.
export const SaleUpdateMetadataSchema =
  saleUpdateMetadataSchema as unknown as z.ZodSchema<SaleUpdateMetadataInput>;
export const ExpenseUpdateMetadataSchema =
  expenseUpdateMetadataSchema as unknown as z.ZodSchema<ExpenseUpdateMetadataInput>;
export const FinancialUpdateMetadataSchema =
  financialUpdateMetadataSchema as unknown as z.ZodSchema<FinancialUpdateMetadataInput>;
// TRANSPORT_PARITY_AUDIT_PLAN.md §6.4 follow-up 3 worked example: this core
// schema now carries `category` (packages/core/src/validators/
// customService.ts) — it was missing even though preload.ts's
// `customServices.updateMetadata` binding types it and
// `CustomServiceService.updateCustomServiceMetadata` /
// `CustomServiceRepository.updateMetadata` already read/persist it. The IPC
// handler below is fixed to forward it alongside adopting this schema.
export const CustomServiceUpdateMetadataSchema =
  customServiceUpdateMetadataSchema as unknown as z.ZodSchema<CustomServiceUpdateMetadataInput>;
export const LotoUpdateMetadataSchema =
  lotoUpdateMetadataSchema as unknown as z.ZodSchema<LotoUpdateMetadataInput>;

// LIRA-306 — offline desktop fallback contracts (pairing, events, manifest),
// defined once in packages/core/src/validators/offline.ts (rule 14). Same
// zod-major cast bridge as above. Used by the desktop sync client/recorder.
import {
  pairDeviceSchema as corePairDeviceSchema,
  checkinSchema as coreCheckinSchema,
  offlineEventSchema as coreOfflineEventSchema,
  uploadEventsSchema as coreUploadEventsSchema,
  manifestSchema as coreManifestSchema,
  type PairDeviceInput,
  type CheckinInput,
  type OfflineEventInput,
  type UploadEventsInput,
  type ManifestInput,
} from "@liratek/core";
export const PairDeviceSchema =
  corePairDeviceSchema as unknown as z.ZodSchema<PairDeviceInput>;
export const CheckinSchema =
  coreCheckinSchema as unknown as z.ZodSchema<CheckinInput>;
export const OfflineEventSchema =
  coreOfflineEventSchema as unknown as z.ZodSchema<OfflineEventInput>;
export const UploadEventsSchema =
  coreUploadEventsSchema as unknown as z.ZodSchema<UploadEventsInput>;
export const ManifestSchema =
  coreManifestSchema as unknown as z.ZodSchema<ManifestInput>;

// LIRA-306 T041 — named payloads for the positional transactions:void /
// transactions:refund channels (core validators/transaction.ts).
export const TransactionVoidSchema =
  coreTransactionVoidSchema as unknown as z.ZodSchema<{ transactionId: number }, z.ZodTypeDef, TransactionVoidInput>;
export const TransactionRefundSchema =
  coreTransactionRefundSchema as unknown as z.ZodSchema<
    {
      transactionId: number;
      refundLegs?: z.infer<typeof RefundLegsSchema> | null;
      refundUnitExtras?: z.infer<typeof RefundUnitExtrasSchema> | null;
      exchangeRate?: number;
      keptChange?: z.infer<typeof RefundKeptChangeSchema> | null;
      // LIRA-342 — the customer gives money back during the refund.
      addedChange?: RefundAddedChangeInput | null;
    },
    z.ZodTypeDef,
    TransactionRefundInput
  >;

// LIRA-306 Phase 6 (Agent B families) — schemas lifted to core for offline
// recording (rule 23 three-way key diffs in the family tests). Same zod-major
// cast bridge as above. One contiguous block — append here.
import {
  expenseIdParamSchema as coreExpenseIdParamSchema,
  type ExpenseIdParamInput,
  addCreditSchema as coreAddCreditSchema,
  type AddCreditInput,
  debtUpdateMetadataSchema as coreDebtUpdateMetadataSchema,
  type DebtUpdateMetadataInput,
  createFinancialServiceSchema as coreCreateFinancialServiceSchema,
  type CreateFinancialServiceInput,
  saleDeleteDraftSchema as coreSaleDeleteDraftSchema,
  type SaleDeleteDraftInput,
  sessionIdPayloadSchema as coreSessionIdPayloadSchema,
  type SessionIdPayloadInput,
  sessionCartRemoveSchema as coreSessionCartRemoveSchema,
  type SessionCartRemoveInput,
} from "@liratek/core";
export const ExpenseIdParamSchema =
  coreExpenseIdParamSchema as unknown as z.ZodSchema<ExpenseIdParamInput>;
export const DebtAddCreditSchema =
  coreAddCreditSchema as unknown as z.ZodSchema<AddCreditInput>;
export const DebtUpdateMetadataSchema =
  coreDebtUpdateMetadataSchema as unknown as z.ZodSchema<DebtUpdateMetadataInput>;
export const FinancialServiceSchema =
  coreCreateFinancialServiceSchema as unknown as z.ZodSchema<CreateFinancialServiceInput>;
export const SaleDeleteDraftSchema =
  coreSaleDeleteDraftSchema as unknown as z.ZodSchema<SaleDeleteDraftInput>;
export const SessionIdPayloadSchema =
  coreSessionIdPayloadSchema as unknown as z.ZodSchema<SessionIdPayloadInput>;
export const SessionCartRemoveSchema =
  coreSessionCartRemoveSchema as unknown as z.ZodSchema<SessionCartRemoveInput>;
// END LIRA-306 Phase 6 (Agent B)

// LIRA-306 Phase 6 (Agent C — maintenance family, T093) — rule 23 lifts for
// maintenance:delete / maintenance:update-metadata (core
// validators/maintenance.ts). Same zod-major cast bridge as above.
import {
  maintenanceIdParamSchema as coreMaintenanceIdParamSchema,
  maintenanceUpdateMetadataSchema as coreMaintenanceUpdateMetadataSchema,
  type MaintenanceUpdateMetadataInput,
} from "@liratek/core";
// output `{ id: number }` (the core input type is `unknown`: z.coerce)
export const MaintenanceIdParamSchema =
  coreMaintenanceIdParamSchema as unknown as z.ZodSchema<{ id: number }>;
export const MaintenanceUpdateMetadataSchema =
  coreMaintenanceUpdateMetadataSchema as unknown as z.ZodSchema<MaintenanceUpdateMetadataInput>;
// END LIRA-306 Phase 6 (Agent C — maintenance)

// LIRA-306 Phase 6 (Agent C — custom-services + loto families, T095/T097) —
// rule 23 lifts (core validators/customService.ts). Same zod-major cast
// bridge as above. Three-way diff for custom-services:add: core
// createCustomServiceSchema has every key the old local copy had (none
// dropped); desktop newly gets the core refines (a cost or price > 0,
// CUSTOMER_ACCOUNT needs a client, GIFT_CARD needs a voucher, no
// CUSTOMER_ACCOUNT on a for-partner service), the length caps, an optional
// description and an ISO `transaction_time` — exactly what REST already
// enforced.
import {
  createCustomServiceSchema as coreCreateCustomServiceSchema,
  type CreateCustomServiceInput as CoreCreateCustomServiceInput,
  customServiceIdParamSchema as coreCustomServiceIdParamSchema,
  type CustomServiceIdParamInput,
} from "@liratek/core";
export const CustomServiceCreateSchema =
  coreCreateCustomServiceSchema as unknown as z.ZodSchema<CoreCreateCustomServiceInput>;
export const CustomServiceIdParamSchema =
  coreCustomServiceIdParamSchema as unknown as z.ZodSchema<
    { id: number },
    z.ZodTypeDef,
    CustomServiceIdParamInput
  >;
// END LIRA-306 Phase 6 (Agent C — custom-services + loto)

// LIRA-306 Phase 6 (Agent C — checkpoints family, T103) — rule 23 lifts.
// closing:create-checkpoint: core createCheckpointSchema (the REST twin's);
// three-way diff vs preload/handler: only `user_id` is dropped, which the
// handler already ignored (actor = session user). loto:checkpoint:delete /
// create-scheduled: named payloads `{ id }` / `{ checkpointDate? }`.
import {
  createCheckpointSchema as coreCreateCheckpointSchema,
  type CreateCheckpointPayload,
  type CreateCheckpointInput,
  lotoCheckpointDeleteSchema as coreLotoCheckpointDeleteSchema,
  type LotoCheckpointDeleteInput,
  lotoCheckpointCreateScheduledSchema as coreLotoCheckpointCreateScheduledSchema,
  type LotoCheckpointCreateScheduledInput,
} from "@liratek/core";
export const CreateCheckpointSchema =
  coreCreateCheckpointSchema as unknown as z.ZodSchema<
    CreateCheckpointInput,
    z.ZodTypeDef,
    CreateCheckpointPayload
  >;
export const LotoCheckpointDeleteSchema =
  coreLotoCheckpointDeleteSchema as unknown as z.ZodSchema<
    { id: number },
    z.ZodTypeDef,
    LotoCheckpointDeleteInput
  >;
export const LotoCheckpointCreateScheduledSchema =
  coreLotoCheckpointCreateScheduledSchema as unknown as z.ZodSchema<
    { checkpointDate?: string },
    z.ZodTypeDef,
    LotoCheckpointCreateScheduledInput
  >;
// END LIRA-306 Phase 6 (Agent C — checkpoints)

// LIRA-333 — app:open-external (links opened outside LiraTek). The allow-list
// lives in core (validators/app.ts) and is shared with the web arm.
import {
  openExternalUrlSchema as coreOpenExternalUrlSchema,
  type OpenExternalUrlInput,
} from "@liratek/core";
export const OpenExternalUrlSchema =
  coreOpenExternalUrlSchema as unknown as z.ZodSchema<
    { url: string },
    z.ZodTypeDef,
    OpenExternalUrlInput
  >;

// LIRA-335 — checkpoint differences. The schemas live in core
// (validators/closing.ts) and are shared with the REST routes in
// backend/src/api/closing.ts (rule 14). Each input is `{ difference_id }` /
// `{ at }` only; the actor is the session's user, never a client field.
import {
  closeCheckpointDifferenceSchema as coreCloseCheckpointDifferenceSchema,
  reopenCheckpointDifferenceSchema as coreReopenCheckpointDifferenceSchema,
  openDifferencesAfterSchema as coreOpenDifferencesAfterSchema,
  type CloseCheckpointDifferenceInput,
  type ReopenCheckpointDifferenceInput,
  type OpenDifferencesAfterInput,
} from "@liratek/core";
export const CloseCheckpointDifferenceSchema =
  coreCloseCheckpointDifferenceSchema as unknown as z.ZodSchema<
    CloseCheckpointDifferenceInput,
    z.ZodTypeDef,
    CloseCheckpointDifferenceInput
  >;
export const ReopenCheckpointDifferenceSchema =
  coreReopenCheckpointDifferenceSchema as unknown as z.ZodSchema<
    ReopenCheckpointDifferenceInput,
    z.ZodTypeDef,
    ReopenCheckpointDifferenceInput
  >;
export const OpenDifferencesAfterSchema =
  coreOpenDifferencesAfterSchema as unknown as z.ZodSchema<
    OpenDifferencesAfterInput,
    z.ZodTypeDef,
    OpenDifferencesAfterInput
  >;

// LIRA-348 — the paging keys of transactions:get-recent / audit:search
// (shared with the REST routes, rule 14). Validated on their own and merged
// into the filters those channels already forward (rule 23).
import {
  transactionPageFiltersSchema as coreTransactionPageFiltersSchema,
  auditPageFiltersSchema as coreAuditPageFiltersSchema,
  type TransactionPageCursor,
} from "@liratek/core";
type TransactionPageFiltersShape = {
  day_from?: string;
  day_to?: string;
  before?: TransactionPageCursor;
};
type AuditPageFiltersShape = {
  dayFrom?: string;
  dayTo?: string;
  beforeId?: number;
};
export const TransactionPageFiltersSchema =
  coreTransactionPageFiltersSchema as unknown as z.ZodSchema<
    TransactionPageFiltersShape,
    z.ZodTypeDef,
    TransactionPageFiltersShape
  >;
export const AuditPageFiltersSchema =
  coreAuditPageFiltersSchema as unknown as z.ZodSchema<
    AuditPageFiltersShape,
    z.ZodTypeDef,
    AuditPageFiltersShape
  >;

/**
 * Zod schemas for IPC handler input validation.
 *
 * These schemas guard every write-path IPC handler. They run before any data
 * touches the database, catching malformed or malicious payloads early.
 */

import { z } from "zod";
import {
  saleProcessSchema,
  lotoSellSchema,
  lotoCashPrizeSchema,
  lotoTicketUpdateSchema,
  lotoFeeSchema,
  lotoCheckpointCreateSchema,
  lotoCheckpointSettleSchema,
  lotoCheckpointsSettleBatchSchema,
  sessionCheckoutSchema,
  holdMoneyCreateSchema,
  debtCashOutSchema,
  debtAccountEntrySchema,
  addRepaymentSchema,
  debtUseCreditSchema,
  debtWriteOffSchema,
  voucherCreateSchema,
  supplierLedgerEntrySchema,
  supplierSettleSchema,
  supplierCashflowSchema,
  supplierPurchaseCreateSchema,
  supplierWriteOffSchema,
  partnerRecordTransactionSchema,
  partnerSettleSchema,
  partnerWriteOffSchema,
  stockAdjustSchema,
  productListFiltersSchema,
  voidCheckoutGroupSchema,
  refundLegsSchema,
  carrierLineCreateSchema,
  carrierLineUpdateSchema,
  carrierLineUpdateBalanceSchema,
  recordCarrierLineUsageSchema,
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
  type CreateRechargeInput,
  type TopUpAppInput,
  type TopUpFromSupplierInput,
  type TopUpFromPartnerInput,
  type TopUpFromClientInput,
  type UpdateRechargeMetadataInput,
  type SelfChargeTelecomItemInput,
  type StockAdjustInput,
  type ProductListFilters,
  type VoidCheckoutGroupInput,
  type RefundLegsInput,
  type CarrierLineCreateInput,
  type CarrierLineUpdateInput,
  type CarrierLineUpdateBalanceInput,
  type RecordCarrierLineUsageInput,
  type MobileServiceItemUpdateInput,
  type MobileServiceItemCreateInput,
  type VoucherCreateInput,
  type DebtCashOutInput,
  type DebtAccountEntryInput,
  type AddRepaymentInput,
  type DebtUseCreditInput,
  type DebtWriteOffInput,
  type HoldMoneyCreateInput,
  type SaleProcessInput,
  type LotoSellInput,
  type LotoCashPrizeInput,
  type LotoTicketUpdateInput,
  type LotoFeeInput,
  type LotoCheckpointCreateInput,
  type LotoCheckpointSettleInput,
  type LotoCheckpointsSettleBatchInput,
  type SessionCheckoutInput,
  type SupplierLedgerEntryInput,
  type SupplierSettleInput,
  type SupplierCashflowInput,
  type SupplierPurchaseCreateInput,
  type SupplierWriteOffInput,
  type PartnerRecordTransactionInput,
  type PartnerSettleInput,
  type PartnerWriteOffInput,
  type CreateDrawerCashoutInput,
  type CreateWalletExchangeInput,
  type CreateDrawerTransferInput,
  type CreateServiceProviderInput,
  type UpdateServiceProviderInput,
  updateExchangeMetadataSchema,
  type UpdateExchangeMetadataInput,
  exchangeSubmitSchema,
  type ExchangeSubmitInput,
  refundUnitExtrasSchema,
  type RefundUnitExtrasInput,
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

export const SaleRefundSchema = z.number().int().positive();

// =============================================================================
// Inventory
// =============================================================================

const PRICE_GT_COST_MSG = {
  message: "Selling price must be greater than cost price",
  path: ["retail_price"],
} as const;

function priceGtCostCheck(d: {
  retail_price: number;
  cost_price: number;
}): boolean {
  return !(
    d.retail_price > 0 &&
    d.cost_price > 0 &&
    d.retail_price <= d.cost_price
  );
}

const ProductBaseShape = z.object({
  barcode: z.string(),
  name: z.string().min(1, "Product name is required"),
  category: z.string().min(1),
  cost_price: z.number().nonnegative(),
  retail_price: z.number().nonnegative(),
  whish_price: z.number().nonnegative().optional(),
  stock_quantity: z.number().int().nonnegative().optional(),
  min_stock_level: z.number().int().nonnegative().optional(),
  image_url: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  // LIRA-143 v157 (decision #4): duration on the MODEL, set on the product
  // form; NULL/omitted = no warranty. tracks_imei_units is NOT a product
  // write field — it lives on the category (see UpdateCategorySchema).
  warranty_months: z.number().int().nonnegative().optional().nullable(),
});

/** Create: id must NOT be sent — the database auto-generates it. */
export const ProductCreateSchema = ProductBaseShape.refine(
  (d) => priceGtCostCheck(d),
  { message: PRICE_GT_COST_MSG.message, path: ["retail_price"] },
);

/** Update: id is required to identify the row to modify. */
export const ProductUpdateSchema = ProductBaseShape.extend({
  id: z.number().int().positive("Product ID is required for updates"),
}).refine((d) => priceGtCostCheck(d), {
  message: PRICE_GT_COST_MSG.message,
  path: ["retail_price"],
});

/** @deprecated Use ProductCreateSchema or ProductUpdateSchema instead. */
export const ProductInputSchema = ProductBaseShape.extend({
  id: z.number().int().positive().optional(),
}).refine((d) => priceGtCostCheck(d), {
  message: PRICE_GT_COST_MSG.message,
  path: ["retail_price"],
});

export const BatchUpdateSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
  category: z.string().optional(),
  min_stock_level: z.number().int().nonnegative().optional(),
  supplier: z.string().optional().nullable(),
});

// The stock-adjustment contract lives in packages/core/src/validators/inventory.ts
// so the Electron IPC handler and the REST route validate against ONE schema
// (CLAUDE.md rule 14). Cast bridges the zod major mismatch (core types against
// zod 4, this workspace types against zod 3); the runtime API used is identical.
export const StockAdjustSchema =
  stockAdjustSchema as unknown as z.ZodSchema<StockAdjustInput>;

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

export const CreateUserSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(4, "Password must be at least 4 characters"),
  role: z.enum(["admin", "staff"]),
});

export const SetPasswordSchema = z.object({
  id: z.number().int().positive(),
  password: z.string().min(4, "Password must be at least 4 characters"),
});

export const SetUserActiveSchema = z.object({
  id: z.number().int().positive(),
  is_active: z.union([z.literal(0), z.literal(1)]),
});

export const SetUserRoleSchema = z.object({
  id: z.number().int().positive(),
  role: z.enum(["admin", "staff"]),
});

// =============================================================================
// Expenses
// =============================================================================

export const AddExpenseSchema = z.object({
  description: z.string().min(1, "Description is required"),
  category: z.string().min(1, "Category is required"),
  expense_type: z.string().optional(),
  paid_by_method: z.string().optional(),
  amount_usd: z.number().nonnegative(),
  amount_lbp: z.number().nonnegative(),
  expense_date: z.string().min(8),
});

// =============================================================================
// Maintenance
// =============================================================================

export const MaintenanceJobSchema = z.object({
  id: z.number().int().positive().optional(),
  device_name: z.string().min(1, "Device name is required"),
  issue_description: z.string().min(1, "Issue description is required"),
  cost_usd: z.number().nonnegative(),
  price_usd: z.number().nonnegative(),
  cost_lbp: z.number().nonnegative().optional(),
  price_lbp: z.number().nonnegative().optional(),
  currency: z.enum(["USD", "LBP"]).optional().default("USD"),
  client_id: z.number().int().positive().optional().nullable(),
  client_name: z.string().optional().nullable(),
  client_phone: z.string().optional().nullable(),
  status: z
    .enum(["Received", "In_Progress", "Ready", "Delivered", "Delivered_Paid"])
    .optional()
    .default("Received"),
  paid_usd: z.number().nonnegative().optional(),
  paid_lbp: z.number().nonnegative().optional(),
  exchange_rate: z.number().positive().optional(),
  discount_usd: z.number().nonnegative().optional(),
  final_amount_usd: z.number().nonnegative().optional(),
  final_amount_lbp: z.number().nonnegative().optional(),
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        currency_code: z.string().min(1),
        amount: z.number(),
        direction: z.enum(["IN", "OUT"]).optional(),
      }),
    )
    .optional(),
  change_given_usd: z.number().optional(),
  change_given_lbp: z.number().optional(),
  // T3 keep-change (KC-3) — LOCAL duplicate of the core schema (rule-14
  // debt, same trap as DebtRepaymentSchema): fields must exist in BOTH or the
  // desktop path silently strips them.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
});

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

const FinancialPaymentLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number(),
  voucherCode: z.string().optional(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

// FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 3 (migration v154):
// `provider` stopped being a closed 9-value enum at the DB layer (the CHECK
// is now a composite FK against the tenant-scoped `service_providers` config
// table) and at the shared core schema
// (`packages/core/src/validators/financial.ts`'s `providerCodeSchema`) — this
// LOCAL field mirrors that same shape/rationale rather than importing the
// core schema directly: `packages/core` validators are zod v4
// (packages/core/package.json), this file's workspace is zod v3
// (root package.json), and embedding a v4 field schema inside a v3
// `z.object()` does not type-check the way the whole-schema
// `as unknown as z.ZodSchema<T>` cast (used elsewhere in this file, e.g.
// `SaleProcessSchema`) bridges — that trick works at the top level of an
// exported schema, not for splicing one version's field schema into
// another's object shape. Keep this regex/length pair in sync with
// `providerCodeSchema` if either changes (same pre-existing rule-14 debt as
// every other field this schema already duplicates from the core one — see
// the comments throughout this schema).
const localProviderCodeSchema = z
  .string()
  .min(1, "Provider is required")
  .max(50, "Provider code must be 50 characters or fewer")
  .regex(
    /^[A-Za-z0-9_]+$/,
    "Provider code may only contain letters, numbers, and underscores",
  );

export const FinancialServiceSchema = z
  .object({
    provider: localProviderCodeSchema,
    serviceType: z.enum(["SEND", "RECEIVE", "BILL"]),
    amount: z.number().nonnegative(),
    currency: z.string().optional(),
    commission: z.number().nonnegative().optional().default(0),
    cost: z.number().nonnegative().optional(),
    price: z.number().nonnegative().optional(),
    paidByMethod: z.string().optional(),
    payments: z.array(FinancialPaymentLegSchema).optional(),
    // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.2/§1.4, Phase A — LOCAL duplicate
    // of the core createFinancialServiceSchema field (rule-14 debt, same trap
    // as kept_change_usd/checkoutTotal below): fee-on-top RECEIVE only, the
    // customer's provider fee collected via operator-chosen legs (split
    // allowed, any method incl. CUSTOMER_ACCOUNT) instead of the legacy
    // implicit single leg. No `direction`/`voucherCode` — narrower than
    // FinancialPaymentLegSchema above (a fee leg is always customer-paid IN,
    // never change, and GIFT_CARD redemption isn't wired here).
    //
    // §6bis finding 6 (2026-08-06 adversarial review, Phase A2 fix package):
    // this comment used to claim "the repository is the enforcement layer for
    // the desktop path" as the reason the core schema's four feePayments
    // `.refine()`s were not mirrored here. That claim was WRONG — findings
    // 1/2/4/5 are exactly the repository silently discarding feePayments on
    // several paths (FOR-partner RECEIVE, THROUGH-partner, zero/omitted fee,
    // deferPayment) instead of hard-rejecting. Phase A2 fixed
    // FinancialServiceRepository.createTransaction to be the real, authoritative
    // guard (placed right after `resolvedProviderFee` resolves, before the
    // FOR-partner dispatch) AND mirrored all four refines onto THIS schema
    // (chained via `.refine()` after the closing `})` below) as a second,
    // earlier layer. Repository is authoritative; this schema is
    // defense-in-depth that rejects at the IPC door with the same message
    // instead of deep inside the repository. Keep both layers in sync if the
    // rule ever changes — fields (and now refines) must exist in BOTH schema
    // files or the desktop path silently strips/under-validates it (rule 14).
    feePayments: z
      .array(
        z.object({
          method: z.string().min(1),
          currencyCode: z.string().min(1),
          amount: z.number().positive(),
        }),
      )
      .optional(),
    clientId: z.number().optional(),
    clientName: z.string().optional(),
    referenceNumber: z.string().optional(),
    phoneNumber: z.string().optional(),
    senderName: z.string().optional(),
    senderPhone: z.string().optional(),
    receiverName: z.string().optional(),
    receiverPhone: z.string().optional(),
    senderClientId: z.number().optional(),
    receiverClientId: z.number().optional(),
    omtServiceType: z.string().optional(),
    omtFee: z.number().optional(),
    whishFee: z.number().optional(),
    profitRate: z.number().optional(),
    payFee: z.boolean().optional(),
    itemKey: z.string().optional(),
    itemCategory: z.string().optional(),
    note: z.string().optional(),
    includingFees: z.boolean().optional(),
    paymentMethodFee: z.number().optional(),
    paymentMethodFeeRate: z.number().optional(),
    returnedCreditsUsd: z.number().optional(),
    // LIRA-090 (v140) Only-Days fields — all three optional; their absence is the
    // "this is a normal (non Only-Days) financial service" signal and preserves
    // byte-identical behaviour for every pre-ticket caller. Zod strips unknown
    // keys by default, so these MUST be declared here or the computed credit-return
    // feature is dead code over IPC (B2 blocker). Matched verbatim against
    // `CreateFinancialServiceData` in FinancialServiceRepository.ts:
    //   mobileServiceItemId  — the catalog item id; its presence drives the computed
    //     returned-credit default and the primary carrier-line movement (spec §5.1/§8).
    //   returnedCreditsUsd   — operator override; 0 is a meaningful value ("no credit
    //     returned this time") so z.number() without .nonnegative() guard is correct;
    //     the field ABOVE is now also plain .number() to match (it was .nonnegative()
    //     before — 0 override was inadvertently accepted, but the intent is preserved).
    //   telecomCreditReturns — walk-in aggregated cart: per-line override array
    //     (spec §6 bug 2 groundwork). One entry per Only-Days line in the cart.
    mobileServiceItemId: z.number().int().positive().optional(),
    telecomCreditReturns: z
      .array(
        z.object({
          itemCategory: z.string().optional(),
          mobileServiceItemId: z.number().int().positive().optional(),
          returnedCreditsUsd: z.number().optional(),
        }),
      )
      .optional(),
    partnerId: z.number().optional(),
    partnerMode: z.enum(["THROUGH", "FOR"]).optional(),
    cashoutMethod: z.string().optional(),
    // T3 keep-change (KC-4) — LOCAL duplicate of core createFinancialServiceSchema
    // (rule-14 debt): fields must exist in BOTH. Kept (not returned) change per currency → added
    // to the transaction's profit stamp (tender-native amounts).
    kept_change_usd: z.number().nonnegative().optional(),
    kept_change_lbp: z.number().nonnegative().optional(),
    transaction_time: z.string().optional(),
    // Batch member whose customer payment is booked by another transaction in the
    // same checkout (session basket, or the legs-carrying first bill of a
    // multi-bill payment): skips the customer-inflow and change-leg blocks while
    // still booking cost outflow + supplier commission.
    deferPayment: z.boolean().optional(),
    // Payment-Legs Integrity plan (Wave 8) — LOCAL duplicate of the core
    // createFinancialServiceSchema field (rule-14 debt, same trap as
    // kept_change_usd/lbp above): the bills/catalog cart's CARRIER transaction
    // (the one that carries `payments`) may attach the full checkout total
    // here so the repository reconciles legs against the WHOLE cart rather
    // than this one unit's `price`. Fields must exist in BOTH or the desktop
    // path silently strips it.
    checkoutTotal: z
      .object({
        usd: z.number().min(0),
        lbp: z.number().min(0),
      })
      .optional(),
    // Payment-Legs Integrity plan (Wave 9) — LOCAL duplicate of the core
    // createFinancialServiceSchema field (rule-14 debt, same trap as
    // checkoutTotal above): the USD→LBP rate MultiPaymentInput actually
    // converted the customer's tender at (may be the buy rate, per the
    // owner's 2026-07-06 MPI-buy-rate decision), used to reconcile legs
    // instead of the stamped rate-of-record. Fields must exist in BOTH or the
    // desktop path silently strips it.
    tender_exchange_rate: z.number().positive().optional(),
    // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+) — LOCAL duplicate of the core
    // createFinancialServiceSchema field (rule-14 debt, same trap as
    // checkoutTotal/deferPayment above): identifies which multi-unit split
    // checkout this unit belongs to, sent with EVERY unit (carrier and
    // siblings alike) by KatchForm/FinancialForm. Fields must exist in BOTH or
    // the desktop path silently strips them.
    split_group: z.string().uuid().optional(),
    split_role: z.enum(["carrier", "sibling"]).optional(),
    split_units: z.number().int().min(2).optional(),
    // Acting user id; the handler overrides this with the authenticated user,
    // but allowing it through keeps validatePayload from stripping a supplied one.
    userId: z.number().int().optional(),
  })
  .refine(
    (data) => {
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.4: feePayments is fee-on-top
      // RECEIVE only. `includingFees: true` nets the fee out of the payout
      // instead — there is nothing left for a separate fee leg to collect.
      if (
        data.feePayments &&
        data.feePayments.length > 0 &&
        data.includingFees === true
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "feePayments is only valid when includingFees is false (fee-on-top RECEIVE) — a fee-included transaction nets the fee out of the payout instead of collecting it separately",
      path: ["feePayments"],
    },
  )
  .refine(
    (data) => {
      if (
        data.feePayments &&
        data.feePayments.length > 0 &&
        data.serviceType !== "RECEIVE"
      ) {
        return false;
      }
      return true;
    },
    {
      message: "feePayments is only valid on serviceType RECEIVE",
      path: ["feePayments"],
    },
  )
  .refine(
    (data) => {
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis finding 1: a partner
      // transaction (FOR or THROUGH) has no walk-in fee to collect — FOR
      // never reads feePayments at all (PFT-3b dispatch), THROUGH suppresses
      // the fee leg via skipSystemDrawer — both used to silently drop the
      // field. Reject either mode up front.
      if (data.feePayments && data.feePayments.length > 0 && data.partnerId) {
        return false;
      }
      return true;
    },
    {
      message:
        "feePayments cannot be used on a partner transaction — the partner handles the fee",
      path: ["feePayments"],
    },
  )
  .refine(
    (data) => {
      // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §6bis finding 2: the resolved
      // provider fee must actually be > 0 — legs against a zero/omitted fee
      // used to be silently dropped by the repository's inner gate
      // (`receiveFeeAmt > 0`) with no reconcile and no booking.
      // §10.2: BINANCE has no `omtFee`/`whishFee` field of its own — its
      // customer-facing fee travels in `commission` (verified against the
      // live frontend contract, `CryptoForm.tsx`'s `commission: fee`, which
      // never populates omtFee/whishFee for Binance). Mirrors the identical
      // BINANCE branch on the core validator (packages/core/src/validators/
      // financial.ts) and the repository's `feePresenceSource`
      // (`FinancialServiceRepository.ts`) — one fee resolution, kept in sync
      // across the rule-14 duplicate (this file) and its consumers.
      if (
        data.feePayments &&
        data.feePayments.length > 0 &&
        (data.omtFee ?? 0) <= 0 &&
        (data.whishFee ?? 0) <= 0 &&
        !(data.provider === "BINANCE" && (data.commission ?? 0) > 0)
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        "feePayments requires a non-zero omtFee/whishFee/commission — there is no fee to collect",
      path: ["feePayments"],
    },
  );

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

export const CustomServiceCreateSchema = z.object({
  description: z.string().min(1, "Description is required"),
  cost_usd: z.coerce.number().nonnegative().default(0),
  cost_lbp: z.coerce.number().nonnegative().default(0),
  price_usd: z.coerce.number().nonnegative().default(0),
  price_lbp: z.coerce.number().nonnegative().default(0),
  paid_by: z.string().min(1).default("CASH"),
  status: z.enum(["pending", "completed"]).optional().default("completed"),
  client_id: z.coerce.number().int().positive().optional(),
  client_name: z.string().optional(),
  phone_number: z.string().optional(),
  note: z.string().optional(),
  category: z.string().optional(),
  voucher_code: z.string().optional(),
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        currency_code: z.string().min(1),
        amount: z.number(),
        voucher_code: z.string().optional(),
        direction: z.enum(["IN", "OUT"]).optional(),
      }),
    )
    .optional(),
  // T3 keep-change (KC-3) — LOCAL duplicate of the core schema (rule-14
  // debt, same trap as DebtRepaymentSchema): fields must exist in BOTH or the
  // desktop path silently strips them.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  transaction_time: z.string().optional(),
  // LIRA-081 — LOCAL duplicate of the core createCustomServiceSchema field
  // (rule-14 debt, same trap documented elsewhere in this file): fields must
  // exist in BOTH or the desktop path silently strips them.
  partnerId: z.number().int().positive().optional(),
  partnerMode: z.enum(["FOR"]).optional(),
  // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 — LOCAL duplicate of the
  // core createCustomServiceSchema field (same rule-14 trap): an
  // inventory-backed service must decrement stock like a POS sale; omitting
  // this here would silently strip product_id on the desktop path and the
  // repository would never learn a product was involved.
  product_id: z.coerce.number().int().positive().optional(),
});

// =============================================================================
// Hold Money
// =============================================================================

// Lifted to packages/core/src/validators/holdMoney.ts so the IPC handler and
// the REST route validate against ONE schema (rule 14). Cast bridges the
// zod-major mismatch (core=zod4, this workspace=zod3); runtime API identical.
export const HoldMoneyCreateSchema =
  holdMoneyCreateSchema as unknown as z.ZodSchema<HoldMoneyCreateInput>;

// =============================================================================
// Drawer Top-Up
// =============================================================================

// External (Cash In) mode only accepts extra_currencies — the from-drawer
// transfer create has no schema here (out of scope, see
// DrawerTopUpRepository.CreateDrawerTopUpFromDrawerData: a debit against a
// missing source-drawer currency row silently no-ops, so only External mode
// is safe for a brand-new currency).
export interface DrawerTopUpCreateInput {
  amount_usd: number;
  amount_lbp: number;
  extra_currencies?: {
    currency_code: string;
    amount: number;
    /** EXCHANGE_LOT_SETTLEMENT.md Q3, refined 2026-08-23 — the operator's
     *  manual cost-basis override (via the top-up modal's "edit" link). No
     *  longer required for a lot-tracked (non-USD/LBP) entry; see
     *  DrawerTopUpRepository's CreateDrawerTopUpData doc for the full
     *  resolution order (override > configured market rate > feed hint >
     *  error). */
    acquisition_usd_per_unit?: number;
    /** NEW (2026-08-23 refinement) — the live-feed USD-per-unit rate,
     *  auto-attached by the frontend ONLY for a currency with no configured
     *  `exchange_rates` row. Ignored server-side when a configured rate row
     *  exists. See DrawerTopUpRepository's CreateDrawerTopUpData doc. */
    market_usd_per_unit_hint?: number;
  }[];
  notes?: string;
  transaction_time?: string;
}

// Explicit `z.ZodSchema<DrawerTopUpCreateInput>` cast: `validatePayload`'s
// generic infers T from BOTH the schema's Output (amount_usd/lbp non-optional
// thanks to `.default(0)`) and Input (optional, since `.default()` makes a
// field omittable) positions of the ZodEffects chain the two `.refine()`s
// produce — TS widens T to include `| undefined` on amount_usd/lbp when left
// to infer on its own, which then fails CreateDrawerTopUpData's
// `amount_usd: number` at the handler's `svc.addTopUp(validation.data, …)`
// call. Pinning T explicitly (same mechanism as this file's core-schema
// `as unknown as z.ZodSchema<...>` casts elsewhere) sidesteps that inference
// ambiguity.
export const DrawerTopUpCreateSchema = z
  .object({
    amount_usd: z.number().nonnegative().default(0),
    amount_lbp: z.number().nonnegative().default(0),
    extra_currencies: z
      .array(
        z.object({
          currency_code: z.string().trim().min(1).max(10),
          amount: z.number().positive(),
          acquisition_usd_per_unit: z.number().positive().optional(),
          market_usd_per_unit_hint: z.number().positive().optional(),
        }),
      )
      .optional(),
    notes: z.string().optional(),
    transaction_time: z.string().optional(),
  })
  .refine(
    (d) =>
      d.amount_usd > 0 ||
      d.amount_lbp > 0 ||
      (d.extra_currencies?.some((e) => e.amount > 0) ?? false),
    {
      message:
        "At least one amount (USD, LBP, or another currency) must be greater than zero.",
    },
  )
  .refine(
    (d) => {
      const codes = (d.extra_currencies ?? []).map((e) =>
        e.currency_code.toUpperCase(),
      );
      return new Set(codes).size === codes.length;
    },
    { message: "Duplicate currency in extra_currencies." },
  ) as unknown as z.ZodSchema<DrawerTopUpCreateInput>;

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

export const DebtAddCreditSchema = z
  .object({
    clientId: z.number().int().positive(),
    amountUsd: z.number().nonnegative().default(0),
    amountLbp: z.number().nonnegative().default(0),
    note: z.string().max(500).optional(),
    transactionTime: z.string().optional(),
  })
  .refine((data) => data.amountUsd > 0 || data.amountLbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

// CQ-9 (rule 14): lifted to packages/core/src/validators/debt.ts so the IPC
// handler (debt:use-credit) and the new REST route (POST
// /api/debts/use-credit) validate against ONE schema. Cast bridges the
// zod-major mismatch (core=zod4, this workspace=zod3); runtime API and field
// names/laxity are unchanged (byte-for-byte lift of the local schema this
// replaces).
export const DebtUseCreditSchema =
  debtUseCreditSchema as unknown as z.ZodSchema<DebtUseCreditInput>;

// CQ-10 (D4: admin-only on both transports) — standalone debt write-off.
// Lifted to packages/core/src/validators/debt.ts so the IPC handler
// (debt:write-off) and the REST route (POST /api/debts/write-off) validate
// against ONE schema (rule 14). Cast bridges the zod-major mismatch.
export const DebtWriteOffSchema =
  debtWriteOffSchema as unknown as z.ZodSchema<DebtWriteOffInput>;

// =============================================================================
// Clients
// =============================================================================

export const ClientCreateSchema = z.object({
  id: z.number().int().positive().optional(),
  full_name: z.string().min(1, "Full name is required"),
  phone_number: z.string().min(1, "Phone number is required"),
  notes: z.string().optional().nullable(),
  whatsapp_opt_in: z.union([z.boolean(), z.literal(0), z.literal(1)]),
});

// =============================================================================
// Suppliers
// =============================================================================

export const SupplierCreateSchema = z.object({
  name: z.string().min(1, "Supplier name is required"),
  contact_name: z.string().optional(),
  phone: z.string().optional(),
  note: z.string().optional(),
  module_key: z.string().optional(),
  provider: z.string().optional(),
});

// CQ-8 (rule 14): lifted to packages/core/src/validators/supplier.ts so the
// IPC handlers (supplierHandlers.ts) and any REST route validate against ONE
// schema each. Casts bridge the zod-major mismatch (core=zod4, this
// workspace=zod3); runtime API identical. Field names unchanged.
export const SupplierLedgerEntrySchema =
  supplierLedgerEntrySchema as unknown as z.ZodSchema<SupplierLedgerEntryInput>;
export const SupplierSettleSchema =
  supplierSettleSchema as unknown as z.ZodSchema<SupplierSettleInput>;
export const SupplierCashflowSchema =
  supplierCashflowSchema as unknown as z.ZodSchema<SupplierCashflowInput>;
export const SupplierPurchaseCreateSchema =
  supplierPurchaseCreateSchema as unknown as z.ZodSchema<SupplierPurchaseCreateInput>;

// CQ-10 (D4: admin-only on both transports) — standalone supplier write-off.
// Lifted to packages/core/src/validators/supplier.ts so the IPC handler
// (suppliers:write-off) and the REST route (POST /api/suppliers/:id/write-off)
// validate against ONE schema (rule 14). Cast bridges the zod-major mismatch.
export const SupplierWriteOffSchema =
  supplierWriteOffSchema as unknown as z.ZodSchema<SupplierWriteOffInput>;

// =============================================================================
// Vouchers (Gift Cards)
// =============================================================================

// The voucher-create contract lives in packages/core/src/validators/voucher.ts
// so the Electron IPC handler and the REST route validate against ONE schema
// (CLAUDE.md rule 14). Re-exported under the historical local name.
export const VoucherCreateSchema =
  voucherCreateSchema as unknown as z.ZodSchema<VoucherCreateInput>;

// =============================================================================
// Customer Sessions — basket checkout
// =============================================================================

// The session checkout contract lives in packages/core/src/validators/session.ts
// so the IPC handler and the REST route validate against ONE schema (rule 14).
// Cast bridges the zod major mismatch (core types against zod 4, this workspace
// against zod 3); the runtime API is identical.
export const SessionCheckoutSchema =
  sessionCheckoutSchema as unknown as z.ZodSchema<SessionCheckoutInput>;

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

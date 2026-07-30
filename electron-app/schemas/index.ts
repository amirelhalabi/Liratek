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
  voidCheckoutGroupSchema,
  refundLegsSchema,
  carrierLineCreateSchema,
  carrierLineUpdateSchema,
  carrierLineUpdateBalanceSchema,
  mobileServiceItemUpdateSchema,
  createDrawerCashoutSchema,
  createWalletExchangeSchema,
  createSystemFloatTopupSchema,
  type StockAdjustInput,
  type VoidCheckoutGroupInput,
  type RefundLegsInput,
  type CarrierLineCreateInput,
  type CarrierLineUpdateInput,
  type CarrierLineUpdateBalanceInput,
  type MobileServiceItemUpdateInput,
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
  type CreateSystemFloatTopupInput,
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

export const RechargeSchema = z.object({
  provider: z.enum(["MTC", "Alfa"]),
  type: z.enum(["CREDIT_TRANSFER", "VOUCHER", "DAYS", "ALFA_GIFT"]),
  amount: z.number().positive(),
  cost: z.number().nonnegative(),
  price: z.number().nonnegative(),
  paid_by_method: z.string().optional(),
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        currencyCode: z.string().min(1),
        amount: z.number(),
        voucherCode: z.string().optional(),
        direction: z.enum(["IN", "OUT"]).optional(),
      }),
    )
    .optional(),
  phoneNumber: z.string().optional(),
  clientId: z.number().optional(),
  clientName: z.string().optional(),
  currency: z.string().optional(),
  // T3 keep-change (KC-3) — LOCAL duplicate of the core schema (rule-14
  // debt, same trap as DebtRepaymentSchema): fields must exist in BOTH or the
  // desktop path silently strips them.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  default_price_to_client: z.number().nonnegative().optional(),
  // PFT-3a (Partner FOR-Transactions) — LOCAL duplicate of the core schema
  // (rule-14 debt, same trap as DebtRepaymentSchema): fields must exist in
  // BOTH or the desktop path silently strips them.
  partnerId: z.number().int().positive().optional(),
  partnerMode: z.enum(["FOR"]).optional(),
  // Payment-Legs Integrity plan (false-reject fix, 2026-07-2x) — LOCAL
  // duplicate of the core createRechargeSchema field (rule-14 debt, same
  // trap as partnerId/partnerMode above): the USD→LBP rate MultiPaymentInput
  // actually converted the customer's tender at, used to reconcile legs
  // instead of the stamped rate-of-record. Fields must exist in BOTH or the
  // desktop path silently strips it.
  tender_exchange_rate: z.number().positive().optional(),
});

export const RechargeCustomerTopUpSchema = z.object({
  provider: z.enum(["MTC", "Alfa"]),
  creditsAmount: z.number().positive(),
  cashPaid: z.number().nonnegative(),
  cashPaidCurrency: z.enum(["USD", "LBP"]).default("USD"),
});

export const TopUpFromSupplierSchema = z.object({
  provider: z.enum(["iPick", "Katsh"]),
  amount: z.number().positive(),
  currency: z.enum(["USD", "LBP"]),
});

export const TopUpFromPartnerSchema = z.object({
  provider: z.literal("WHISH_APP"),
  partnerId: z.number().int().positive(),
  amount: z.number().positive(),
  currency: z.enum(["USD", "LBP"]),
});

export const TopUpFromClientSchema = z.object({
  amount: z.number().positive(),
  cashPaid: z.number().nonnegative(),
  currency: z.enum(["USD", "LBP"]),
  clientName: z.string().optional(),
  clientId: z.number().int().positive().optional(),
});

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

export const FinancialServiceSchema = z.object({
  provider: z.enum([
    "OMT",
    "WHISH",
    "BOB",
    "OTHER",
    "iPick",
    "Katsh",
    "WHISH_APP",
    "OMT_APP",
    "BINANCE",
  ]),
  serviceType: z.enum(["SEND", "RECEIVE", "BILL"]),
  amount: z.number().nonnegative(),
  currency: z.string().optional(),
  commission: z.number().nonnegative().optional().default(0),
  cost: z.number().nonnegative().optional(),
  price: z.number().nonnegative().optional(),
  paidByMethod: z.string().optional(),
  payments: z.array(FinancialPaymentLegSchema).optional(),
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
  returnedCreditsUsd: z.number().nonnegative().optional(),
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
});

// =============================================================================
// Exchange
// =============================================================================

export const ExchangeTransactionSchema = z.object({
  fromCurrency: z.string().min(1),
  toCurrency: z.string().min(1),
  amountIn: z.number().positive(),
  amountOut: z.number().positive(),
  leg1Rate: z.number(),
  leg1MarketRate: z.number(),
  leg1ProfitUsd: z.number(),
  leg2Rate: z.number().optional(),
  leg2MarketRate: z.number().optional(),
  leg2ProfitUsd: z.number().optional(),
  viaCurrency: z.string().optional(),
  totalProfitUsd: z.number(),
  clientName: z.string().optional(),
  note: z.string().optional(),
  fromCurrencyName: z.string().optional(),
  toCurrencyName: z.string().optional(),
  // LIRA-081 — LOCAL duplicate of the core createExchangeSchema field (rule-14
  // debt, same trap documented elsewhere in this file): fields must exist in
  // BOTH or the desktop path silently strips them.
  partnerId: z.number().int().positive().optional(),
  partnerMode: z.enum(["FOR"]).optional(),
  // Split payout (2026-07-30) — LOCAL duplicate of the core
  // createExchangeSchema fields (rule-14 debt, same trap as partnerId above).
  payments: z
    .array(
      z.object({
        method: z.string(),
        currencyCode: z.string(),
        amount: z.number().positive(),
        direction: z.enum(["IN", "OUT"]).optional(),
      }),
    )
    .optional(),
  tender_exchange_rate: z.number().positive().optional(),
});

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
export const MobileServiceItemUpdateSchema =
  mobileServiceItemUpdateSchema as unknown as z.ZodSchema<MobileServiceItemUpdateInput>;

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
  extra_currencies?: { currency_code: string; amount: number }[];
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
// System Float Top-Up (OMT_System / Whish_System)
// =============================================================================

// The system-float-topup contract lives in
// packages/core/src/validators/systemFloatTopup.ts so the Electron IPC handler
// and the REST route validate against ONE schema (CLAUDE.md rule 14). Cast
// bridges the zod-major mismatch (core=zod4, this workspace=zod3); runtime
// API used is identical.
export const SystemFloatTopupSchema =
  createSystemFloatTopupSchema as unknown as z.ZodSchema<CreateSystemFloatTopupInput>;

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

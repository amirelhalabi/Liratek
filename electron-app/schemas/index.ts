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
  voucherCreateSchema,
  type VoucherCreateInput,
  type DebtCashOutInput,
  type DebtAccountEntryInput,
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

export const StockAdjustSchema = z.object({
  id: z.number().int().positive(),
  newQuantity: z.number().int().nonnegative(),
});

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
  transaction_time: z.string().optional(),
  // Batch member whose customer payment is booked by another transaction in the
  // same checkout (session basket, or the legs-carrying first bill of a
  // multi-bill payment): skips the customer-inflow and change-leg blocks while
  // still booking cost outflow + supplier commission.
  deferPayment: z.boolean().optional(),
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
// Debt Repayment
// =============================================================================

const RepaymentPaymentLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

export const DebtRepaymentSchema = z.object({
  clientId: z.number().int().positive(),
  amountUSD: z.number().nonnegative(),
  amountLBP: z.number().nonnegative(),
  paidAmountUSD: z.number().optional(),
  paidAmountLBP: z.number().optional(),
  drawerName: z.string().optional(),
  note: z.string().optional(),
  paidByMethod: z.string().optional(),
  payments: z.array(RepaymentPaymentLegSchema).optional(),
  // T3 keep-change (KC-2): kept (not returned) change per currency → profit
  // stamp on the DEBT_REPAYMENT transaction. Same stripping trap as
  // transaction_time below: this schema is a LOCAL duplicate of core's
  // addRepaymentSchema (rule-14 debt — the REST route validates the core one;
  // lift/consolidate like DebtCashOutSchema when next touched), so new fields
  // must be added in BOTH places or the desktop path silently drops them.
  keptChangeUSD: z.number().nonnegative().optional(),
  keptChangeLBP: z.number().nonnegative().optional(),
  // Operator time-override — without this Zod stripped it and the repayment
  // "Set custom time" silently did nothing.
  transaction_time: z.string().optional(),
});

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

export const DebtUseCreditSchema = z
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

export const SupplierLedgerEntrySchema = z.object({
  supplier_id: z.number().int().positive(),
  entry_type: z.enum(["TOP_UP", "PAYMENT", "ADJUSTMENT"]),
  amount_usd: z.number(),
  amount_lbp: z.number(),
  note: z.string().optional(),
  drawer_name: z.string().optional(),
});

const SettlementPaymentSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
});

export const SupplierSettleSchema = z.object({
  supplier_id: z.number().int().positive(),
  financial_service_ids: z.array(z.number().int().positive()).min(1),
  amount_usd: z.number(),
  amount_lbp: z.number(),
  commission_usd: z.number(),
  commission_lbp: z.number(),
  drawer_name: z.string(),
  note: z.string().optional(),
  payments: z.array(SettlementPaymentSchema).optional(),
});

/** Pay a supplier / record a supplier paying us, via payment-method legs. */
export const SupplierCashflowSchema = z.object({
  supplier_id: z.number().int().positive(),
  direction: z.enum(["PAY", "RECEIVE"]),
  payments: z.array(SettlementPaymentSchema).min(1),
  note: z.string().optional(),
  exchange_rate: z.number().positive().optional(),
});

/** Log a delivery batch for a product supplier (FIFO payment coverage). */
export const SupplierPurchaseCreateSchema = z.object({
  supplier_id: z.number().int().positive(),
  total_usd: z.number().positive("Amount must be greater than 0"),
  note: z.string().optional(),
});

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

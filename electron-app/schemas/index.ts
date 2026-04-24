/**
 * Zod schemas for IPC handler input validation.
 *
 * These schemas guard every write-path IPC handler. They run before any data
 * touches the database, catching malformed or malicious payloads early.
 */

import { z } from "zod";

// =============================================================================
// Sales
// =============================================================================

const PaymentLineSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
});

export const SaleProcessSchema = z.object({
  client_id: z.number().int().nullable(),
  client_name: z.string().optional(),
  client_phone: z.string().optional(),
  items: z
    .array(
      z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().positive(),
        price: z.number().nonnegative(),
        imei: z.string().optional(),
      }),
    )
    .min(1, "Sale must have at least one item"),
  total_amount: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  final_amount: z.number().nonnegative(),
  payment_usd: z.number().nonnegative(),
  payment_lbp: z.number().nonnegative(),
  payments: z.array(PaymentLineSchema).optional(),
  change_given_usd: z.number().optional(),
  change_given_lbp: z.number().optional(),
  exchange_rate: z.number().positive(),
  drawer_name: z.string().optional(),
  id: z.number().int().positive().optional(),
  status: z.enum(["completed", "draft", "cancelled"]).optional(),
  note: z.string().optional(),
});

export const SaleRefundSchema = z.number().int().positive();

// =============================================================================
// Inventory
// =============================================================================

const ProductBaseSchema = z.object({
  barcode: z.string().min(1, "Barcode is required"),
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
export const ProductCreateSchema = ProductBaseSchema;

/** Update: id is required to identify the row to modify. */
export const ProductUpdateSchema = ProductBaseSchema.extend({
  id: z.number().int().positive("Product ID is required for updates"),
});

/** @deprecated Use ProductCreateSchema or ProductUpdateSchema instead. */
export const ProductInputSchema = ProductBaseSchema.extend({
  id: z.number().int().positive().optional(),
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
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        currency_code: z.string().min(1),
        amount: z.number(),
      }),
    )
    .optional(),
  change_given_usd: z.number().optional(),
  change_given_lbp: z.number().optional(),
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
      }),
    )
    .optional(),
  phoneNumber: z.string().optional(),
  clientId: z.number().optional(),
  clientName: z.string().optional(),
  currency: z.string().optional(),
});

// =============================================================================
// Financial Services (OMT / WHISH / BOB / iPick / Katsh / Binance)
// =============================================================================

const FinancialPaymentLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number(),
});

export const FinancialServiceSchema = z.object({
  provider: z.enum([
    "OMT",
    "WHISH",
    "BOB",
    "OTHER",
    "iPick",
    "Katsh",
    "WISH_APP",
    "OMT_APP",
    "BINANCE",
  ]),
  serviceType: z.enum(["SEND", "RECEIVE"]),
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
});

// =============================================================================
// Loto
// =============================================================================

export const LotoSellSchema = z.object({
  ticket_number: z.string().optional(),
  sale_amount: z.number().positive(),
  commission_rate: z.number().optional(),
  is_winner: z.boolean().optional(),
  prize_amount: z.number().optional(),
  sale_date: z.string().optional(),
  payment_method: z.string().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
});

export const LotoCashPrizeSchema = z.object({
  ticket_number: z.string(),
  prize_amount: z.number().positive(),
  prize_date: z.string().optional(),
  customer_name: z.string().optional(),
  note: z.string().optional(),
});

export const LotoFeeSchema = z.object({
  fee_amount: z.number().positive(),
  fee_month: z.string().min(1),
  fee_year: z.number().int().positive(),
  recorded_date: z.string().optional(),
  note: z.string().optional(),
});

export const LotoCheckpointCreateSchema = z.object({
  checkpoint_date: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  note: z.string().optional(),
});

const CheckpointPaymentSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
});

export const LotoCheckpointSettleSchema = z.object({
  id: z.number().int().positive(),
  totalSales: z.number().nonnegative(),
  totalCommission: z.number().nonnegative(),
  totalPrizes: z.number().nonnegative(),
  totalCashPrizes: z.number().optional(),
  settledAt: z.string().optional(),
  payments: z.array(CheckpointPaymentSchema).optional(),
});

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
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        currency_code: z.string().min(1),
        amount: z.number(),
      }),
    )
    .optional(),
});

// =============================================================================
// Debt Repayment
// =============================================================================

const RepaymentPaymentLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number(),
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
});

// =============================================================================
// Clients
// =============================================================================

export const ClientCreateSchema = z.object({
  id: z.number().int().positive().optional(),
  full_name: z.string().min(1, "Full name is required"),
  phone_number: z.string().min(1, "Phone number is required"),
  notes: z.string().optional(),
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

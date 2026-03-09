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
    .enum(["Received", "In_Progress", "Ready", "Delivered"])
    .optional()
    .default("Received"),
  paid_usd: z.number().nonnegative().optional(),
  paid_lbp: z.number().nonnegative().optional(),
  exchange_rate: z.number().positive().optional(),
});

// =============================================================================
// Recharge
// =============================================================================

export const RechargeSchema = z.object({
  provider: z.enum(["MTC", "Alfa"]),
  type: z.enum(["CREDIT_TRANSFER", "VOUCHER", "DAYS"]),
  amount: z.number().positive(),
  cost: z.number().nonnegative(),
  price: z.number().nonnegative(),
  paid_by_method: z.string().optional(),
  phoneNumber: z.string().optional(),
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

/**
 * Zod validation schemas for shared types.
 * These can be used on both frontend and backend for validation.
 */

import { z } from 'zod';
import { VALIDATION } from '../constants';

// =============================================================================
// Base Schemas
// =============================================================================

export const SQLiteBooleanSchema = z.union([z.literal(0), z.literal(1)]);

export const CurrencyCodeSchema = z.enum(['USD', 'LBP', 'EUR']);

export const DrawerIdSchema = z.enum(['drawer1', 'drawer2']);

export const UserRoleSchema = z.enum(['admin', 'cashier']);

export const ISODateStringSchema = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/));

// =============================================================================
// Auth Schemas
// =============================================================================

export const LoginRequestSchema = z.object({
  username: z.string()
    .min(VALIDATION.USERNAME_MIN_LENGTH, `Username must be at least ${VALIDATION.USERNAME_MIN_LENGTH} characters`)
    .max(VALIDATION.USERNAME_MAX_LENGTH, `Username must be at most ${VALIDATION.USERNAME_MAX_LENGTH} characters`),
  password: z.string()
    .min(1, 'Password is required'),
});

export const ChangePasswordRequestSchema = z.object({
  userId: z.number().int().positive(),
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(VALIDATION.PASSWORD_MIN_LENGTH, `Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`)
    .max(VALIDATION.PASSWORD_MAX_LENGTH, `Password must be at most ${VALIDATION.PASSWORD_MAX_LENGTH} characters`),
});

// =============================================================================
// User Schemas
// =============================================================================

export const CreateUserRequestSchema = z.object({
  username: z.string()
    .min(VALIDATION.USERNAME_MIN_LENGTH)
    .max(VALIDATION.USERNAME_MAX_LENGTH),
  password: z.string()
    .min(VALIDATION.PASSWORD_MIN_LENGTH)
    .max(VALIDATION.PASSWORD_MAX_LENGTH),
  role: UserRoleSchema,
});

export const UpdateUserRequestSchema = z.object({
  id: z.number().int().positive(),
  username: z.string()
    .min(VALIDATION.USERNAME_MIN_LENGTH)
    .max(VALIDATION.USERNAME_MAX_LENGTH)
    .optional(),
  role: UserRoleSchema.optional(),
  is_active: SQLiteBooleanSchema.optional(),
});

// =============================================================================
// Product Schemas
// =============================================================================

export const CreateProductRequestSchema = z.object({
  sku: z.string()
    .min(1, 'SKU is required')
    .regex(VALIDATION.SKU_REGEX, 'SKU can only contain letters, numbers, hyphens, and underscores'),
  name: z.string()
    .min(1, 'Product name is required')
    .max(200, 'Product name is too long'),
  category: z.string()
    .min(1, 'Category is required'),
  cost_usd: z.number()
    .min(0, 'Cost must be non-negative'),
  price_usd: z.number()
    .min(0, 'Price must be non-negative'),
  price_lbp: z.number()
    .min(0, 'LBP price must be non-negative'),
  quantity: z.number()
    .int('Quantity must be a whole number')
    .min(0, 'Quantity must be non-negative'),
  reorder_level: z.number()
    .int('Reorder level must be a whole number')
    .min(0, 'Reorder level must be non-negative')
    .optional()
    .default(10),
});

export const UpdateProductRequestSchema = z.object({
  id: z.number().int().positive(),
  sku: z.string()
    .min(1)
    .regex(VALIDATION.SKU_REGEX)
    .optional(),
  name: z.string().min(1).max(200).optional(),
  category: z.string().min(1).optional(),
  cost_usd: z.number().min(0).optional(),
  price_usd: z.number().min(0).optional(),
  price_lbp: z.number().min(0).optional(),
  quantity: z.number().int().min(0).optional(),
  reorder_level: z.number().int().min(0).optional(),
  is_active: SQLiteBooleanSchema.optional(),
});

// =============================================================================
// Client Schemas
// =============================================================================

export const CreateClientRequestSchema = z.object({
  name: z.string()
    .min(1, 'Client name is required')
    .max(200, 'Client name is too long'),
  phone: z.string()
    .regex(VALIDATION.PHONE_REGEX, 'Invalid phone number format')
    .optional()
    .nullable(),
  whatsapp_opt_in: SQLiteBooleanSchema.optional().default(0),
  notes: z.string().max(1000, 'Notes are too long').optional().nullable(),
});

export const UpdateClientRequestSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200).optional(),
  phone: z.string().regex(VALIDATION.PHONE_REGEX).optional().nullable(),
  whatsapp_opt_in: SQLiteBooleanSchema.optional(),
  notes: z.string().max(1000).optional().nullable(),
  is_active: SQLiteBooleanSchema.optional(),
});

// =============================================================================
// Sale Schemas
// =============================================================================

export const SaleItemRequestSchema = z.object({
  product_id: z.number().int().positive(),
  product_name: z.string().min(1),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  unit_price_usd: z.number().min(0),
});

export const CreateSaleRequestSchema = z.object({
  drawer_id: DrawerIdSchema,
  client_id: z.number().int().positive().optional(),
  items: z.array(SaleItemRequestSchema).min(1, 'At least one item is required'),
  subtotal_usd: z.number().min(0),
  discount_usd: z.number().min(0).default(0),
  total_usd: z.number().min(0),
  payment_method: z.string().min(1),
  amount_paid_usd: z.number().min(0),
  amount_paid_lbp: z.number().min(0),
  change_usd: z.number().min(0),
  change_lbp: z.number().min(0),
  cashier_id: z.number().int().positive(),
  create_debt: z.boolean().optional().default(false),
});

// =============================================================================
// Debt Schemas
// =============================================================================

export const CreateDebtRequestSchema = z.object({
  client_id: z.number().int().positive(),
  sale_id: z.number().int().positive().optional(),
  original_amount_usd: z.number().positive('Debt amount must be greater than 0'),
  notes: z.string().max(1000).optional(),
});

export const DebtPaymentRequestSchema = z.object({
  debt_id: z.number().int().positive(),
  amount_usd: z.number().positive('Payment amount must be greater than 0'),
  payment_method: z.string().min(1),
  notes: z.string().max(1000).optional(),
});

// =============================================================================
// Exchange Schemas
// =============================================================================

export const SetExchangeRateRequestSchema = z.object({
  from_currency: CurrencyCodeSchema,
  to_currency: CurrencyCodeSchema,
  rate: z.number().positive('Exchange rate must be greater than 0'),
}).refine(data => data.from_currency !== data.to_currency, {
  message: 'From and to currencies must be different',
});

export const ExchangeTransactionRequestSchema = z.object({
  drawer_id: DrawerIdSchema,
  from_currency: CurrencyCodeSchema,
  to_currency: CurrencyCodeSchema,
  from_amount: z.number().positive(),
  rate_used: z.number().positive(),
  cashier_id: z.number().int().positive(),
});

// =============================================================================
// Drawer Schemas
// =============================================================================

export const OpenDrawerRequestSchema = z.object({
  drawer_id: DrawerIdSchema,
  cashier_id: z.number().int().positive(),
  opening_balance_usd: z.number().min(0),
  opening_balance_lbp: z.number().min(0),
});

export const CloseDrawerRequestSchema = z.object({
  drawer_id: DrawerIdSchema,
  cashier_id: z.number().int().positive(),
  closing_balance_usd: z.number().min(0),
  closing_balance_lbp: z.number().min(0),
});

// =============================================================================
// Recharge Schemas
// =============================================================================

export const CreateRechargeRequestSchema = z.object({
  drawer_id: DrawerIdSchema,
  provider: z.string().min(1),
  amount_usd: z.number().positive(),
  phone_number: z.string().regex(VALIDATION.PHONE_REGEX, 'Invalid phone number'),
  client_id: z.number().int().positive().optional(),
  cashier_id: z.number().int().positive(),
});

// =============================================================================
// OMT Schemas
// =============================================================================

export const CreateOMTRequestSchema = z.object({
  drawer_id: DrawerIdSchema,
  transaction_type: z.enum(['send', 'receive']),
  amount_usd: z.number().positive(),
  fee_usd: z.number().min(0).optional().default(0),
  recipient_name: z.string().max(200).optional(),
  sender_name: z.string().max(200).optional(),
  phone_number: z.string().regex(VALIDATION.PHONE_REGEX).optional(),
  client_id: z.number().int().positive().optional(),
  cashier_id: z.number().int().positive(),
  notes: z.string().max(1000).optional(),
});

// =============================================================================
// Expense Schemas
// =============================================================================

export const CreateExpenseRequestSchema = z.object({
  drawer_id: DrawerIdSchema,
  category: z.string().min(1),
  description: z.string().min(1, 'Description is required').max(500),
  amount_usd: z.number().positive('Amount must be greater than 0'),
  cashier_id: z.number().int().positive(),
});

// =============================================================================
// Pagination Schemas
// =============================================================================

export const PaginatedRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

// =============================================================================
// Type Exports (inferred from schemas)
// =============================================================================

export type LoginRequestValidated = z.infer<typeof LoginRequestSchema>;
export type ChangePasswordRequestValidated = z.infer<typeof ChangePasswordRequestSchema>;
export type CreateUserRequestValidated = z.infer<typeof CreateUserRequestSchema>;
export type UpdateUserRequestValidated = z.infer<typeof UpdateUserRequestSchema>;
export type CreateProductRequestValidated = z.infer<typeof CreateProductRequestSchema>;
export type UpdateProductRequestValidated = z.infer<typeof UpdateProductRequestSchema>;
export type CreateClientRequestValidated = z.infer<typeof CreateClientRequestSchema>;
export type UpdateClientRequestValidated = z.infer<typeof UpdateClientRequestSchema>;
export type CreateSaleRequestValidated = z.infer<typeof CreateSaleRequestSchema>;
export type CreateDebtRequestValidated = z.infer<typeof CreateDebtRequestSchema>;
export type DebtPaymentRequestValidated = z.infer<typeof DebtPaymentRequestSchema>;
export type SetExchangeRateRequestValidated = z.infer<typeof SetExchangeRateRequestSchema>;
export type CreateRechargeRequestValidated = z.infer<typeof CreateRechargeRequestSchema>;
export type CreateOMTRequestValidated = z.infer<typeof CreateOMTRequestSchema>;
export type CreateExpenseRequestValidated = z.infer<typeof CreateExpenseRequestSchema>;

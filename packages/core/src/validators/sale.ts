import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Sales validation schemas
 */

const saleItemSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: positiveIntegerSchema.min(1),
  unit_price_usd: positiveDecimalSchema,
  unit_price_lbp: positiveDecimalSchema.optional(),
  discount_percent: z.number().min(0).max(100).default(0),
});

/**
 * A checkout payment leg (split payment / change). Shared by the Electron IPC
 * handler (sales:process) and the REST route (POST /api/sales/process) —
 * ONE schema, two transports (CLAUDE.md rule 14).
 */
export const salePaymentLegSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
  // Present only for GIFT_CARD legs — the voucher code being redeemed.
  voucher_code: z.string().optional(),
  // IN (customer pays, default) or OUT (shop returns change to customer).
  direction: z.enum(["IN", "OUT"]).optional(),
});

/**
 * The FULL sale-processing payload as sent by the POS checkout — items,
 * split payment legs, change legs, client propagation, exchange rate.
 * This is the contract `SalesService.processSale` is written against.
 */
export const saleProcessSchema = z.object({
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
  payments: z.array(salePaymentLegSchema).optional(),
  change_given_usd: z.number().optional(),
  change_given_lbp: z.number().optional(),
  exchange_rate: z.number().positive(),
  drawer_name: z.string().optional(),
  id: z.number().int().positive().optional(),
  status: z.enum(["completed", "draft", "cancelled"]).optional(),
  note: z.string().optional(),
});

export type SaleProcessInput = z.infer<typeof saleProcessSchema>;

/**
 * @deprecated Thin aspirational contract that never matched what the checkout
 * sends — kept only for its unit test. Use `saleProcessSchema` (above), the
 * real shared contract, for any sale-processing endpoint.
 */
export const createSaleSchema = z.object({
  client_id: z.number().int().positive().optional(),
  client_name: z.string().max(255).optional(),
  items: z.array(saleItemSchema).min(1, "At least one item is required"),
  discount: positiveDecimalSchema.default(0),
  total_usd: positiveDecimalSchema,
  total_lbp: positiveDecimalSchema.optional(),
  amount_paid_usd: positiveDecimalSchema.default(0),
  amount_paid_lbp: positiveDecimalSchema.default(0),
  payment_method: z.string().min(1).default("CASH"),
  drawer_name: z.string().max(100).optional(),
  status: z.enum(["draft", "completed", "refunded"]).default("completed"),
  notes: z.string().max(500).optional(),
  transaction_time: transactionTimeSchema,
});

export const getSaleSchema = z.object({
  id: z.number().int().positive(),
});

export const searchSalesSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  clientId: z.number().int().positive().optional(),
  status: z.enum(["draft", "completed", "refunded"]).optional(),
  limit: z.number().int().positive().max(100).default(50),
});

export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type GetSaleInput = z.infer<typeof getSaleSchema>;
export type SearchSalesInput = z.infer<typeof searchSalesSchema>;

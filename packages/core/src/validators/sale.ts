import { z } from "zod";
import { positiveDecimalSchema, positiveIntegerSchema } from "./common.js";

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

export const createSaleSchema = z.object({
  client_id: z.number().int().positive().optional(),
  client_name: z.string().max(255).optional(),
  items: z.array(saleItemSchema).min(1, "At least one item is required"),
  discount: positiveDecimalSchema.default(0),
  total_usd: positiveDecimalSchema,
  total_lbp: positiveDecimalSchema.optional(),
  amount_paid_usd: positiveDecimalSchema.default(0),
  amount_paid_lbp: positiveDecimalSchema.default(0),
  payment_method: z.enum(["CASH", "CARD", "TRANSFER", "DEBT"]).default("CASH"),
  drawer_name: z.string().max(100).optional(),
  status: z.enum(["draft", "completed", "refunded"]).default("completed"),
  notes: z.string().max(500).optional(),
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

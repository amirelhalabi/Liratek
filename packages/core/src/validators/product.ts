import { z } from "zod";
import { positiveDecimalSchema, positiveIntegerSchema } from "./common.js";

/**
 * Product/Inventory validation schemas
 */

export const createProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(255),
  category: z.string().min(1, "Category is required").max(100),
  barcode: z.string().max(100).optional(),
  cost_price_usd: positiveDecimalSchema,
  retail_price_usd: positiveDecimalSchema,
  cost_price_lbp: positiveDecimalSchema.optional(),
  retail_price_lbp: positiveDecimalSchema.optional(),
  stock: positiveIntegerSchema.default(0),
  min_stock_threshold: positiveIntegerSchema.default(0),
  supplier_id: z.number().int().positive().optional(),
  is_active: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

export const updateProductSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255).optional(),
  category: z.string().min(1).max(100).optional(),
  barcode: z.string().max(100).optional(),
  cost_price_usd: positiveDecimalSchema.optional(),
  retail_price_usd: positiveDecimalSchema.optional(),
  cost_price_lbp: positiveDecimalSchema.optional(),
  retail_price_lbp: positiveDecimalSchema.optional(),
  stock: positiveIntegerSchema.optional(),
  min_stock_threshold: positiveIntegerSchema.optional(),
  supplier_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export const updateStockSchema = z.object({
  id: z.number().int().positive(),
  quantity: z.number().int(),
});

export const searchProductsSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  barcode: z.string().optional(),
  activeOnly: z.boolean().default(true),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type SearchProductsInput = z.infer<typeof searchProductsSchema>;

import { z } from "zod";

/**
 * Service Preset validation schemas
 */

export const createServicePresetSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  category: z.string().min(1, "Category is required").max(100),
  cost_usd: z.coerce.number().min(0).default(0),
  cost_lbp: z.coerce.number().min(0).default(0),
  price_usd: z.coerce.number().min(0).default(0),
  price_lbp: z.coerce.number().min(0).default(0),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
  sort_order: z.coerce.number().int().min(0).default(0),
});

export const updateServicePresetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  category: z.string().min(1).max(100).optional(),
  cost_usd: z.coerce.number().min(0).optional(),
  cost_lbp: z.coerce.number().min(0).optional(),
  price_usd: z.coerce.number().min(0).optional(),
  price_lbp: z.coerce.number().min(0).optional(),
  is_active: z.coerce.number().int().min(0).max(1).optional(),
  sort_order: z.coerce.number().int().min(0).optional(),
});

export type CreateServicePresetInput = z.infer<
  typeof createServicePresetSchema
>;
export type UpdateServicePresetInput = z.infer<
  typeof updateServicePresetSchema
>;

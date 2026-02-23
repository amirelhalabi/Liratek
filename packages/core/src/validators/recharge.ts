import { z } from "zod";
import { positiveDecimalSchema, phoneNumberSchema } from "./common.js";

/**
 * Recharge validation schemas (MTC, Alfa)
 */

export const createRechargeSchema = z.object({
  provider: z.enum(["MTC", "Alfa"]),
  type: z.enum(["CREDIT_TRANSFER", "VOUCHER", "DAYS"]),
  amount: positiveDecimalSchema,
  cost: z.number().min(0).default(0),
  price: positiveDecimalSchema,
  currency: z.string().min(1).default("USD"),
  phoneNumber: phoneNumberSchema.optional(),
  paid_by_method: z.string().min(1).default("CASH"),
  clientId: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

export const getRechargeStockSchema = z.object({
  // No parameters needed - empty schema for consistency
});

export type CreateRechargeInput = z.infer<typeof createRechargeSchema>;
export type GetRechargeStockInput = z.infer<typeof getRechargeStockSchema>;

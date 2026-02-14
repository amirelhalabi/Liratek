import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  phoneNumberSchema,
} from "./common.js";

/**
 * Recharge validation schemas (MTC, ALFA)
 */

export const createRechargeSchema = z.object({
  provider: z.enum(["MTC", "ALFA"]),
  type: z.enum(["prepaid", "postpaid", "internet"]),
  amount: positiveIntegerSchema, // e.g., 10000 LBP
  price: positiveDecimalSchema, // USD price
  phoneNumber: phoneNumberSchema,
  paid_by_method: z.enum(["CASH", "CARD", "TRANSFER"]).default("CASH"),
  note: z.string().max(500).optional(),
});

export const getRechargeStockSchema = z.object({
  // No parameters needed - empty schema for consistency
});

export type CreateRechargeInput = z.infer<typeof createRechargeSchema>;
export type GetRechargeStockInput = z.infer<typeof getRechargeStockSchema>;

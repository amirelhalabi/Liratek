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
  provider: z.enum(["MTC", "ALFA", "Alfa"]),
  type: z.enum([
    "CREDIT_TRANSFER",
    "VOUCHER",
    "DAYS",
    "prepaid",
    "postpaid",
    "internet",
  ]),
  amount: positiveDecimalSchema,
  price: positiveDecimalSchema, // USD price
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

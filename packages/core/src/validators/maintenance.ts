import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  phoneNumberSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Maintenance job validation schemas
 */

const paymentLineSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
});

export const saveMaintenanceJobSchema = z.object({
  id: positiveIntegerSchema.optional(), // For updates
  device_name: z.string().min(1).max(255),
  client_id: positiveIntegerSchema.optional(),
  client_name: z.string().max(255).optional(),
  client_phone: phoneNumberSchema.optional(),
  issue_description: z.string().max(1000).optional(),
  cost_usd: z.number().min(0).optional(),
  price_usd: positiveDecimalSchema,
  cost_lbp: z.number().min(0).optional(),
  price_lbp: z.number().min(0).optional(),
  currency: z.enum(["USD", "LBP"]).optional().default("USD"),
  discount_usd: z.number().min(0).optional(),
  final_amount_usd: positiveDecimalSchema.optional(),
  final_amount_lbp: z.number().min(0).optional(),
  paid_usd: z.number().min(0).optional(),
  paid_lbp: z.number().min(0).optional(),
  exchange_rate: z.number().min(0).optional(),
  status: z
    .enum(["Received", "In_Progress", "Ready", "Delivered", "Delivered_Paid"])
    .default("Received"),
  paid_by: z.string().optional(),
  note: z.string().max(1000).optional(),
  payments: z.array(paymentLineSchema).optional(),
  change_given_usd: z.number().min(0).optional(),
  change_given_lbp: z.number().min(0).optional(),
  // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-3): kept (not
  // returned) change per currency → added to the transaction's profit stamp.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  transaction_time: transactionTimeSchema,
});

export const getMaintenanceJobsSchema = z.object({
  status: z
    .enum([
      "All",
      "Received",
      "In_Progress",
      "Ready",
      "Delivered",
      "Delivered_Paid",
    ])
    .optional(),
});

export type SaveMaintenanceJobInput = z.infer<typeof saveMaintenanceJobSchema>;
export type GetMaintenanceJobsInput = z.infer<typeof getMaintenanceJobsSchema>;

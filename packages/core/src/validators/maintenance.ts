import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  phoneNumberSchema,
} from "./common.js";

/**
 * Maintenance job validation schemas
 */

export const saveMaintenanceJobSchema = z.object({
  id: positiveIntegerSchema.optional(), // For updates
  device_name: z.string().min(1).max(255),
  client_id: positiveIntegerSchema.optional(),
  client_name: z.string().max(255).optional(),
  client_phone: phoneNumberSchema.optional(),
  issue_description: z.string().max(1000).optional(),
  price_usd: positiveDecimalSchema,
  status: z
    .enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .default("PENDING"),
  final_amount_usd: positiveDecimalSchema.optional(),
  notes: z.string().max(1000).optional(),
});

export const getMaintenanceJobsSchema = z.object({
  status: z
    .enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .optional(),
});

export type SaveMaintenanceJobInput = z.infer<typeof saveMaintenanceJobSchema>;
export type GetMaintenanceJobsInput = z.infer<typeof getMaintenanceJobsSchema>;

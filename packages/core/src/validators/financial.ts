import { z } from "zod";
import { positiveDecimalSchema } from "./common.js";

/**
 * Financial services validation schemas (OMT, WHISH, Western Union)
 */

// OMT/WHISH Money Transfer
export const createFinancialServiceSchema = z.object({
  provider: z.enum(["OMT", "WHISH", "WESTERNUNION"]),
  serviceType: z.enum(["SEND", "RECEIVE"]),
  referenceNumber: z.string().min(1).max(100),
  senderName: z.string().min(1).max(255),
  receiverName: z.string().min(1).max(255),
  amountUSD: positiveDecimalSchema,
  commissionUSD: positiveDecimalSchema,
  drawer: z.enum(["OMT_Drawer", "General_Drawer_B"]).optional(),
  note: z.string().max(500).optional(),
});

// Query financial services history
export const getFinancialServicesSchema = z.object({
  provider: z.enum(["OMT", "WHISH", "WESTERNUNION"]).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});

export type CreateFinancialServiceInput = z.infer<
  typeof createFinancialServiceSchema
>;
export type GetFinancialServicesInput = z.infer<
  typeof getFinancialServicesSchema
>;

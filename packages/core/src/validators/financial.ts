import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

/**
 * Financial services validation schemas (OMT, WHISH, Western Union)
 */

// OMT/WHISH Money Transfer
export const createFinancialServiceSchema = z.object({
  provider: z.enum([
    "OMT",
    "WHISH",
    "IPEC",
    "KATCH",
    "WISH_APP",
    "OMT_APP",
    "BOB",
    "OTHER",
  ]),
  serviceType: z.enum(["SEND", "RECEIVE", "BILL_PAYMENT"]),
  amount: positiveDecimalSchema,
  currency: currencyCodeSchema.default("USD"),
  commission: positiveDecimalSchema.default(0),
  clientName: z.string().max(255).optional(),
  referenceNumber: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

// Query financial services history
export const getFinancialServicesSchema = z.object({
  provider: z
    .enum([
      "OMT",
      "WHISH",
      "IPEC",
      "KATCH",
      "WISH_APP",
      "OMT_APP",
      "BOB",
      "OTHER",
    ])
    .optional(),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});

export type CreateFinancialServiceInput = z.infer<
  typeof createFinancialServiceSchema
>;
export type GetFinancialServicesInput = z.infer<
  typeof getFinancialServicesSchema
>;

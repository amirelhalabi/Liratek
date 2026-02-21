import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

/**
 * Financial services validation schemas (OMT, WHISH, IPEC, Katch, etc.)
 */

// OMT/WHISH Money Transfer & IPEC/Katch/WishApp services
export const createFinancialServiceSchema = z
  .object({
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
    cost: z.number().min(0).optional(),
    price: z.number().min(0).optional(),
    paidByMethod: z.string().optional(),
    clientId: z.number().int().positive().optional(),
    clientName: z.string().max(255).optional(),
    referenceNumber: z.string().max(100).optional(),
    itemKey: z.string().max(255).optional(),
    itemCategory: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (data) => {
      // If paying by DEBT, clientId is required
      if (data.paidByMethod === "DEBT" && !data.clientId) {
        return false;
      }
      return true;
    },
    {
      message: "Client is required when paying by DEBT",
      path: ["clientId"],
    },
  );

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

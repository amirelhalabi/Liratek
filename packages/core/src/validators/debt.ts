import { z } from "zod";
import { positiveDecimalSchema, idSchema } from "./common.js";

/**
 * Debt management validation schemas
 */

// Add debt repayment
export const addRepaymentSchema = z
  .object({
    clientId: idSchema,
    amountUSD: positiveDecimalSchema.default(0),
    amountLBP: positiveDecimalSchema.default(0),
    note: z.string().max(500).optional(),
    userId: idSchema.optional(),
    paidByMethod: z.string().min(1).optional(),
  })
  .refine((data) => data.amountUSD > 0 || data.amountLBP > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

// Get debtor summary
export const getDebtorSummarySchema = z.object({
  clientId: idSchema.optional(),
  hasDebtOnly: z.coerce.boolean().default(false),
});

export type AddRepaymentInput = z.infer<typeof addRepaymentSchema>;
export type GetDebtorSummaryInput = z.infer<typeof getDebtorSummarySchema>;

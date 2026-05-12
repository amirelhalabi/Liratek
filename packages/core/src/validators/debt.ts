import { z } from "zod";
import {
  positiveDecimalSchema,
  idSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Debt management validation schemas
 */

const repaymentPaymentLineSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number().min(0),
});

// Add debt repayment
export const addRepaymentSchema = z
  .object({
    clientId: idSchema,
    amountUSD: positiveDecimalSchema.default(0),
    amountLBP: positiveDecimalSchema.default(0),
    note: z.string().max(500).optional(),
    userId: idSchema.optional(),
    paidByMethod: z.string().min(1).optional(),
    payments: z.array(repaymentPaymentLineSchema).optional(),
    transaction_time: transactionTimeSchema,
  })
  .refine(
    (data) =>
      data.amountUSD > 0 ||
      data.amountLBP > 0 ||
      (data.payments &&
        data.payments.length > 0 &&
        data.payments.some((p) => p.amount > 0)),
    {
      message: "At least one amount (USD or LBP) must be greater than 0",
    },
  );

// Add credit (shop owes customer)
export const addCreditSchema = z
  .object({
    clientId: idSchema,
    amountUsd: z.number().min(0).default(0),
    amountLbp: z.number().min(0).default(0),
    note: z.string().max(500).optional(),
    transactionTime: transactionTimeSchema,
  })
  .refine((data) => data.amountUsd > 0 || data.amountLbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

// Get debtor summary
export const getDebtorSummarySchema = z.object({
  clientId: idSchema.optional(),
  hasDebtOnly: z.coerce.boolean().default(false),
});

export type AddRepaymentInput = z.infer<typeof addRepaymentSchema>;
export type AddCreditInput = z.infer<typeof addCreditSchema>;
export type GetDebtorSummaryInput = z.infer<typeof getDebtorSummarySchema>;

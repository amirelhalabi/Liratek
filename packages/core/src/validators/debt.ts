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
    // T3 keep-change (docs/plans/T3_KEEP_CHANGE_PLAN.md KC-2): per-currency
    // change the shop keeps instead of returning. Excluded from the debt
    // reduction by the caller; stamped as profit on the DEBT_REPAYMENT
    // transaction ("Other / kept change" profits line).
    keptChangeUSD: z.number().nonnegative().optional(),
    keptChangeLBP: z.number().nonnegative().optional(),
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

// Payment leg for cash-out / account-entry (carries IN/OUT direction).
const debtPaymentLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

// Cash out a client's prepaid credit (CREDIT_CASH_OUT — drawer OUT). Shared by
// the IPC handler (debt:cash-out) and the REST route (rule 14).
export const debtCashOutSchema = z.object({
  clientId: z.number().int().positive(),
  amountUSD: z.number().nonnegative(),
  amountLBP: z.number().nonnegative(),
  payments: z.array(debtPaymentLegSchema).optional(),
  note: z.string().optional(),
  transaction_time: z.string().optional(),
});

// Manual, till-moving account entry from the Accounts (Debts) page.
// direction "credit" → drawer IN (shop owes customer); "debt" → drawer OUT.
export const debtAccountEntrySchema = z
  .object({
    direction: z.enum(["credit", "debt"]),
    clientId: z.number().int().positive(),
    amountUSD: z.number().nonnegative(),
    amountLBP: z.number().nonnegative(),
    payments: z.array(debtPaymentLegSchema).optional(),
    note: z.string().max(500).optional(),
    transaction_time: z.string().optional(),
  })
  .refine((data) => data.amountUSD > 0 || data.amountLBP > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

export type AddRepaymentInput = z.infer<typeof addRepaymentSchema>;
export type AddCreditInput = z.infer<typeof addCreditSchema>;
export type GetDebtorSummaryInput = z.infer<typeof getDebtorSummarySchema>;
export type DebtCashOutInput = z.infer<typeof debtCashOutSchema>;
export type DebtAccountEntryInput = z.infer<typeof debtAccountEntrySchema>;

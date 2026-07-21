import { z } from "zod";
import { positiveDecimalSchema, transactionTimeSchema } from "./common.js";

/**
 * Drawer Cash-Out validation schema.
 *
 * Mirrors the Drawer Top-Up validator shape (amount_usd/amount_lbp using the
 * shared `positiveDecimalSchema`, `transaction_time` using the shared
 * `transactionTimeSchema`) — see expense.ts/financial.ts for the same reused
 * pair. `notes` is required (unlike Drawer Top-Up's optional notes): a cash
 * withdrawal that is neither an expense nor a transfer needs a stated reason
 * for the audit trail.
 */
export const createDrawerCashoutSchema = z
  .object({
    amount_usd: positiveDecimalSchema.default(0),
    amount_lbp: positiveDecimalSchema.default(0),
    notes: z.string().trim().min(1, "A reason is required").max(500),
    transaction_time: transactionTimeSchema,
  })
  .refine((d) => d.amount_usd > 0 || d.amount_lbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than zero.",
  });

export type CreateDrawerCashoutInput = z.infer<
  typeof createDrawerCashoutSchema
>;

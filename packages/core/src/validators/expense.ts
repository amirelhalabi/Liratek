import { z } from "zod";
import { positiveDecimalSchema, positiveIntegerSchema } from "./common.js";

/**
 * Expense validation schemas
 */

export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  amount_usd: positiveDecimalSchema,
  amount_lbp: positiveDecimalSchema.default(0),
  paid_by_method: z.string().min(1).default("CASH"),
  description: z.string().max(500).optional(),
});

export const deleteExpenseSchema = z.object({
  id: positiveIntegerSchema,
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type DeleteExpenseInput = z.infer<typeof deleteExpenseSchema>;

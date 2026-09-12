import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Expense validation schemas
 */

export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  amount_usd: positiveDecimalSchema,
  amount_lbp: positiveDecimalSchema.default(0),
  paid_by_method: z.string().min(1).default("CASH"),
  description: z.string().max(500).optional(),
  transaction_time: transactionTimeSchema,
});

export const deleteExpenseSchema = z.object({
  id: positiveIntegerSchema,
});

/**
 * Edit non-financial metadata on an `expenses` row — mirrors the
 * `expenses:update-metadata` IPC handler's own inline shape
 * (electron-app/handlers/dbHandlers.ts), which validates nothing beyond
 * `requireRole`. Shared by the REST route (rule 14).
 */
export const expenseUpdateMetadataSchema = z.object({
  id: positiveIntegerSchema,
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type DeleteExpenseInput = z.infer<typeof deleteExpenseSchema>;
export type ExpenseUpdateMetadataInput = z.infer<
  typeof expenseUpdateMetadataSchema
>;

import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Expense validation schemas
 */

/**
 * Owner ticket #26 (2026-09-23) — `expense_date` was MISSING from this
 * shape entirely. Rule 23: a plain `z.object({...})` strips any key not
 * declared here, silently, with no error — so every web (REST) expense
 * ever created via `POST /api/expenses` (`backend/src/api/expenses.ts`
 * does `req.body = createExpenseSchema.parse(req.body)`, replacing the
 * body) had its `expense_date` dropped before `ExpenseRepository
 * .createExpense` ever saw it, and `better-sqlite3` binds a missing/
 * `undefined` value as SQL NULL rather than throwing — so the row was
 * still created, just with `expense_date = NULL` forever.
 * `ProfitRepository.getExpenseTotals`'s `datetime(expense_date,
 * 'localtime') >= ? AND ... <= ?` is NULL for a NULL column (SQL
 * three-valued logic), which SQLite treats as excluding the row — for
 * EVERY date range, not just the "wrong" one. Reproduced directly
 * (`ExpenseRepository`/`ProfitRepository` were not touched — the schema
 * gap alone accounts for the owner's "record an expense, check Profits —
 * not affected"): a wide-open one-year range still returned
 * `{ total: 0, count: 0 }` for a NULL-dated row.
 *
 * `electron-app/schemas/index.ts`'s `AddExpenseSchema` (desktop/IPC) is a
 * SEPARATE, hand-rolled schema (rule 14/19b violation of its own — it
 * should re-export this one) that already declares
 * `expense_date: z.string().min(8)` — desktop was never affected. Matched
 * verbatim here so both transports finally agree (rule 19b: one schema,
 * shared).
 */
export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  amount_usd: positiveDecimalSchema,
  amount_lbp: positiveDecimalSchema.default(0),
  paid_by_method: z.string().min(1).default("CASH"),
  description: z.string().max(500).optional(),
  expense_date: z.string().min(8),
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

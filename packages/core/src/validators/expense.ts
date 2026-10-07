import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  transactionTimeSchema,
} from "./common.js";
import { STOCK_EXPENSE_SOURCES } from "../constants/transactionTypes.js";

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
/**
 * One cash line of a manual expense (owner decision 2026-10-07, payer =
 * "shop"; docs/FEATURE_GUIDE.md "Kept change"). No `direction` (or "IN") =
 * cash the shop HANDS the vendor (drawer debit); `direction: "OUT"` = change
 * the vendor hands BACK into the drawer (drawer credit). Same leg shape the
 * other money schemas use (method / currencyCode / amount / direction).
 */
export const expensePaymentLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number().positive(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

/**
 * Manual expense. `amount_usd`/`amount_lbp` are the BILL (what the vendor
 * charged). Without `payments` the bill is also what left the drawer —
 * exactly the pre-2026-10-07 contract every internal/scripted caller still
 * uses. With `payments` the server derives the stored cost and the drawer
 * legs from the lines (`resolveKeptChange`, payer "shop"): cost = handed −
 * returned, so change the vendor did not return (`kept_change_*`, the
 * client's claim — checked, never trusted) is ADDED TO THE COST.
 * `tender_exchange_rate` is the rate the till converted at (rule 27).
 */
export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  amount_usd: positiveDecimalSchema,
  amount_lbp: positiveDecimalSchema.default(0),
  paid_by_method: z.string().min(1).default("CASH"),
  description: z.string().max(500).optional(),
  expense_date: z.string().min(8),
  transaction_time: transactionTimeSchema,
  payments: z.array(expensePaymentLegSchema).optional(),
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  tender_exchange_rate: z.number().positive().optional(),
});

export const deleteExpenseSchema = z.object({
  id: positiveIntegerSchema,
});

/**
 * `DELETE /api/expenses/:id` (REST) path-param variant of
 * `deleteExpenseSchema` above. `id` uses `z.coerce` — a URL param is ALWAYS a
 * string ("5", never 5), so `deleteExpenseSchema`'s plain `positiveIntegerSchema`
 * (a bare `z.number()`) rejected every single request through
 * `validateParams`, the exact same trap `saleIdParamSchema`
 * (`packages/core/src/validators/sale.ts`) already fixed for
 * `GET /api/sales/:id`. `deleteExpenseSchema` itself is left untouched — no
 * caller currently hands it a string id (rule 14: add the correctly-shaped
 * schema, don't reshape one whose contract is fine for its own callers; the
 * desktop `db:delete-expense` IPC handler validates nothing at all today and
 * passes a real number straight through).
 */
export const expenseIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ExpenseIdParamInput = z.infer<typeof expenseIdParamSchema>;

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

/**
 * LIRA-262 — record that the shop USED one of its own items (an inventory
 * product, or a Katsh / iPick / Whish App catalog item) as an expense.
 *
 * Deliberately carries NO amount, currency or drawer: the server derives the
 * cost itself (FIFO batch cost for inventory, `cost_lbp × quantity` for a
 * catalog item) and the drawer from the source — a client can never book an
 * arbitrary amount through this route, and no payment method exists to
 * pick (no cash moves). Shared by the IPC handler and the REST route (rule
 * 19b); the adapter's payload type is `z.input` of this schema (rule 21).
 */
export const createStockExpenseSchema = z.object({
  source: z.enum(STOCK_EXPENSE_SOURCES),
  /** products.id for INVENTORY, mobile_service_items.id otherwise. */
  item_id: z.number().int().positive(),
  quantity: z.number().int().positive().max(100000),
  category: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // Required, never defaulted: a missing expense_date silently drops the row
  // out of every Profits range (owner ticket #26, see createExpenseSchema).
  expense_date: z.string().min(8),
  transaction_time: transactionTimeSchema,
});

export type CreateStockExpenseInput = z.input<typeof createStockExpenseSchema>;
export type CreateStockExpenseData = z.infer<typeof createStockExpenseSchema>;

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
/** What a client SENDS to add a manual expense (rule 21 — adapter, preload
 *  and page payload types derive from this, never a hand-written copy). */
export type CreateExpenseRequest = z.input<typeof createExpenseSchema>;
export type ExpensePaymentLeg = z.infer<typeof expensePaymentLegSchema>;
export type DeleteExpenseInput = z.infer<typeof deleteExpenseSchema>;
export type ExpenseUpdateMetadataInput = z.infer<
  typeof expenseUpdateMetadataSchema
>;

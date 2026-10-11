/**
 * Offline bindings — expenses family, the rest (LIRA-306 T089). Each calls the
 * SAME `ExpenseService` method its REST route calls (`backend/src/api/
 * expenses.ts`), with the actor from the event (O-new-7), never the payload.
 * `db:add-expense` lives in `expenses.ts` (US1).
 */
import { getExpenseService } from "../../services/ExpenseService.js";
import type { CreateStockExpenseData } from "../../validators/expense.js";
import { actorUsername } from "./actor.js";
import type { BindingResult, OfflineBinding } from "./types.js";

/** POST /api/expenses/stock-use */
const addStockUse: OfflineBinding = {
  channel: "expenses:add-stock-use",
  run: (payload, ctx) =>
    getExpenseService().addStockExpense(payload as unknown as CreateStockExpenseData, ctx.actorUserId) as unknown as BindingResult,
  mainRow: (r) => (typeof r.id === "number" ? { table: "expenses", id: r.id } : null),
};

/** DELETE /api/expenses/:id */
const deleteExpense: OfflineBinding = {
  channel: "db:delete-expense",
  run: (payload, ctx) =>
    getExpenseService().deleteExpense(Number(payload.id), ctx.actorUserId) as unknown as BindingResult,
};

/** POST /api/expenses/update-metadata — `editedBy` = the actor's username. */
const updateMetadata: OfflineBinding = {
  channel: "expenses:update-metadata",
  run: (payload, ctx) => {
    const p = payload as { id: number; description?: string; category?: string; note?: string };
    const result = getExpenseService().updateExpenseMetadata(
      p.id,
      { description: p.description, category: p.category, note: p.note },
      actorUsername(ctx.actorUserId),
    );
    return result.success ? { success: true, data: result.entity } : { success: false, error: result.error };
  },
};

export const EXPENSES_REST_BINDINGS: readonly OfflineBinding[] = [addStockUse, deleteExpense, updateMetadata];

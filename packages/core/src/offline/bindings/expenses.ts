/**
 * Offline bindings — `db:add-expense` (LIRA-306 US1) →
 * `ExpenseService.addExpense(payload, actor)`, what `POST /api/expenses` and
 * the IPC handler call. (The rest of the expenses family is in
 * `expensesRest.ts`.)
 */
import { getExpenseService } from "../../services/ExpenseService.js";
import type { BindingResult, OfflineBinding } from "./types.js";

const dbAddExpense: OfflineBinding = {
  channel: "db:add-expense",
  run: (payload, ctx) =>
    getExpenseService().addExpense(payload as never, ctx.actorUserId) as unknown as BindingResult,
};

export const EXPENSE_BINDINGS: readonly OfflineBinding[] = [dbAddExpense];

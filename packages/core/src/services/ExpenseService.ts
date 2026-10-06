import {
  ExpenseRepository,
  ExpenseEntity,
  CreateExpenseData,
  getExpenseRepository,
} from "../repositories/ExpenseRepository.js";
import type { CreateStockExpenseData } from "../validators/expense.js";
import { toErrorString } from "../utils/errors.js";
import { expenseLogger } from "../utils/logger.js";

export interface ExpenseResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class ExpenseService {
  private repo: ExpenseRepository;

  constructor(repo?: ExpenseRepository) {
    this.repo = repo ?? getExpenseRepository();
  }

  /**
   * Add a new expense
   */
  addExpense(data: CreateExpenseData, userId: number): ExpenseResult {
    try {
      assertTransactionTime(data.transaction_time);

      const id = this.repo.createExpense(data, userId);

      expenseLogger.info(
        {
          id,
          category: data.category,
          paidBy: data.paid_by_method || "CASH",
          amountUSD: data.amount_usd,
          amountLBP: data.amount_lbp,
        },
        `Added: ${data.category}`,
      );
      return { success: true, id };
    } catch (error) {
      expenseLogger.error({ error, data }, "ExpenseService.addExpense error");
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * LIRA-262 — record that the shop used one of its own items (inventory
   * product, or Katsh / iPick / Whish App catalog item) as an expense at
   * cost, with no cash leaving any cash drawer. The ONE core entry point
   * both transports call (IPC `expenses:add-stock-use`, REST
   * `POST /api/expenses/stock-use`).
   */
  addStockExpense(data: CreateStockExpenseData, userId: number): ExpenseResult {
    try {
      assertTransactionTime(data.transaction_time);

      const id = this.repo.createStockExpense(data, userId);

      expenseLogger.info(
        {
          id,
          source: data.source,
          itemId: data.item_id,
          quantity: data.quantity,
        },
        `Added stock-use expense: ${data.source}`,
      );
      return { success: true, id };
    } catch (error) {
      expenseLogger.error(
        { error, data },
        "ExpenseService.addStockExpense error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Get today's expenses
   */
  getTodayExpenses(): ExpenseEntity[] {
    try {
      return this.repo.getTodayExpenses();
    } catch (error) {
      expenseLogger.error({ error }, "ExpenseService.getTodayExpenses error");
      return [];
    }
  }

  /**
   * Delete an expense
   */
  deleteExpense(id: number, userId: number): ExpenseResult {
    try {
      // Get expense details for logging
      const expense = this.repo.getExpenseById(id);

      this.repo.deleteExpense(id, userId);

      if (expense) {
        expenseLogger.info(
          { id, category: expense.category, amountUSD: expense.amount_usd },
          `Deleted: ${expense.category}`,
        );
      }

      return { success: true };
    } catch (error) {
      expenseLogger.error({ error, id }, "ExpenseService.deleteExpense error");
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Update non-financial metadata on an expense record.
   * Records old/new values for audit trail.
   */
  updateExpenseMetadata(
    id: number,
    data: { description?: string; category?: string; note?: string },
    editedBy: string,
  ): {
    success: boolean;
    entity?: ExpenseEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.repo.findById(id);
    if (!existing) {
      return { success: false, error: "Expense not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    const fields = ["description", "category", "note"] as const;

    for (const field of fields) {
      if (data[field] !== undefined && data[field] !== existing[field]) {
        oldValues[field] = existing[field];
        newValues[field] = data[field];
      }
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing };
    }

    const updated = this.repo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    expenseLogger.info(
      { id, editedBy, oldValues, newValues },
      "Expense metadata updated",
    );

    return { success: true, entity: updated, oldValues };
  }
}

/** Shared backdate check for both expense writers. */
function assertTransactionTime(transactionTime: string | undefined): void {
  if (!transactionTime) return;
  const txTime = new Date(transactionTime);
  if (isNaN(txTime.getTime())) {
    throw new Error("Invalid transaction_time format");
  }
  if (txTime > new Date()) {
    throw new Error("transaction_time cannot be in the future");
  }
}

// Singleton instance
let expenseServiceInstance: ExpenseService | null = null;

export function getExpenseService(): ExpenseService {
  if (!expenseServiceInstance) {
    expenseServiceInstance = new ExpenseService();
  }
  return expenseServiceInstance;
}

export function resetExpenseService(): void {
  expenseServiceInstance = null;
}

import {
  ExpenseRepository,
  ExpenseEntity,
  CreateExpenseData,
  getExpenseRepository,
} from "../database/repositories/ExpenseRepository";

export interface ExpenseResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class ExpenseService {
  private repo: ExpenseRepository;

  constructor() {
    this.repo = getExpenseRepository();
  }

  /**
   * Add a new expense
   */
  addExpense(data: CreateExpenseData): ExpenseResult {
    try {
      const id = this.repo.createExpense(data);

      // Log activity
      this.repo.logActivity(1, "Add Expense", {
        category: data.category,
        amount_usd: data.amount_usd,
      });

      console.log(`[EXPENSE] Added: ${data.category} - $${data.amount_usd}`);
      return { success: true, id };
    } catch (error: any) {
      console.error("ExpenseService.addExpense error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get today's expenses
   */
  getTodayExpenses(): ExpenseEntity[] {
    try {
      return this.repo.getTodayExpenses();
    } catch (error) {
      console.error("ExpenseService.getTodayExpenses error:", error);
      return [];
    }
  }

  /**
   * Delete an expense
   */
  deleteExpense(id: number): ExpenseResult {
    try {
      // Get expense details for logging
      const expense = this.repo.getExpenseById(id);

      this.repo.deleteExpense(id);

      // Log activity
      if (expense) {
        this.repo.logActivity(1, "Delete Expense", {
          category: expense.category,
          amount_usd: expense.amount_usd,
        });
        console.log(`[EXPENSE] Deleted: ${expense.category}`);
      }

      return { success: true };
    } catch (error: any) {
      console.error("ExpenseService.deleteExpense error:", error);
      return { success: false, error: error.message };
    }
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

import { BaseRepository } from "./BaseRepository";

export interface ExpenseEntity {
  id: number;
  description: string;
  category: string;
  expense_type: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateExpenseData {
  description: string;
  category: string;
  expense_type: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
}

export class ExpenseRepository extends BaseRepository<ExpenseEntity> {
  constructor() {
    super("expenses");
  }

  /**
   * Create a new expense
   */
  createExpense(data: CreateExpenseData): number {
    const stmt = this.db.prepare(`
      INSERT INTO expenses (description, category, expense_type, amount_usd, amount_lbp, expense_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.description,
      data.category,
      data.expense_type,
      data.amount_usd,
      data.amount_lbp,
      data.expense_date
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Get today's expenses
   */
  getTodayExpenses(): ExpenseEntity[] {
    return this.db
      .prepare(
        `SELECT * FROM expenses 
         WHERE DATE(expense_date) = DATE('now')
         ORDER BY expense_date DESC`
      )
      .all() as ExpenseEntity[];
  }

  /**
   * Get expense by ID
   */
  getExpenseById(id: number): ExpenseEntity | undefined {
    return this.db
      .prepare("SELECT * FROM expenses WHERE id = ?")
      .get(id) as ExpenseEntity | undefined;
  }

  /**
   * Delete an expense by ID
   */
  deleteExpense(id: number): void {
    this.db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
  }

  /**
   * Log activity for expense operations
   */
  logActivity(userId: number, action: string, details: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO activity_logs (user_id, action, details_json, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .run(userId, action, JSON.stringify(details));
  }
}

// Singleton instance
let expenseRepositoryInstance: ExpenseRepository | null = null;

export function getExpenseRepository(): ExpenseRepository {
  if (!expenseRepositoryInstance) {
    expenseRepositoryInstance = new ExpenseRepository();
  }
  return expenseRepositoryInstance;
}

export function resetExpenseRepository(): void {
  expenseRepositoryInstance = null;
}

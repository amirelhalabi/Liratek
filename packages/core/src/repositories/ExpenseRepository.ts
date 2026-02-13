import { BaseRepository } from "./BaseRepository.js";

export interface ExpenseEntity {
  id: number;
  description: string;
  category: string;
  expense_type: string;
  paid_by_method?: "CASH" | "DEBT" | "OMT" | "WHISH" | "BINANCE";
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
  paid_by_method?: "CASH" | "DEBT" | "OMT" | "WHISH" | "BINANCE";
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
    const paidBy = data.paid_by_method || "CASH";
    const drawerName =
      paidBy === "CASH"
        ? "General"
        : paidBy === "DEBT"
          ? "General" // no drawer impact; placeholder
          : paidBy === "OMT"
            ? "OMT_System"
            : paidBy === "WHISH"
              ? "Whish_App"
              : "Binance";

    return this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO expenses (description, category, expense_type, paid_by_method, amount_usd, amount_lbp, expense_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        data.description,
        data.category,
        data.expense_type,
        paidBy,
        data.amount_usd,
        data.amount_lbp,
        data.expense_date,
      );
      const expenseId = Number(result.lastInsertRowid);

      // Only Cash_Out affects drawers, and DEBT means no drawer movement.
      if (data.expense_type === "Cash_Out" && paidBy !== "DEBT") {
        const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        const insertPayment = this.db.prepare(`
          INSERT INTO payments (
            source_type, source_id, method, drawer_name, currency_code, amount, note, created_by
          ) VALUES (
            'EXPENSE', ?, ?, ?, ?, ?, ?, ?
          )
        `);

        const note = `${data.category}: ${data.description}`;
        const createdBy = 1;

        // USD outflow
        if (data.amount_usd && data.amount_usd !== 0) {
          const delta = -Math.abs(data.amount_usd);
          insertPayment.run(expenseId, paidBy, drawerName, "USD", delta, note, createdBy);
          upsertBalance.run(drawerName, "USD", delta);
        }

        // LBP outflow
        if (data.amount_lbp && data.amount_lbp !== 0) {
          const delta = -Math.abs(data.amount_lbp);
          insertPayment.run(expenseId, paidBy, drawerName, "LBP", delta, note, createdBy);
          upsertBalance.run(drawerName, "LBP", delta);
        }
      }

      return expenseId;
    })();
  }

  /**
   * Get today's expenses
   */
  getTodayExpenses(): ExpenseEntity[] {
    return this.db
      .prepare(
        `SELECT * FROM expenses 
         WHERE DATE(expense_date) = DATE('now')
         ORDER BY expense_date DESC`,
      )
      .all() as ExpenseEntity[];
  }

  /**
   * Get expense by ID
   */
  getExpenseById(id: number): ExpenseEntity | undefined {
    return this.db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as
      | ExpenseEntity
      | undefined;
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
  logActivity(
    userId: number,
    action: string,
    details: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO activity_logs (user_id, action, details_json, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
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

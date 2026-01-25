import { BaseRepository } from "./BaseRepository.js";
export class ExpenseRepository extends BaseRepository {
    constructor() {
        super("expenses");
    }
    /**
     * Create a new expense
     */
    createExpense(data) {
        const paidBy = data.paid_by_method || "CASH";
        const drawerName = paidBy === "CASH"
            ? "General"
            : paidBy === "OMT"
                ? "OMT"
                : paidBy === "WHISH"
                    ? "Whish"
                    : "Binance";
        return this.db.transaction(() => {
            const stmt = this.db.prepare(`
        INSERT INTO expenses (description, category, expense_type, paid_by_method, amount_usd, amount_lbp, expense_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
            const result = stmt.run(data.description, data.category, data.expense_type, paidBy, data.amount_usd, data.amount_lbp, data.expense_date);
            const expenseId = Number(result.lastInsertRowid);
            // Only Cash_Out affects drawers
            if (data.expense_type === "Cash_Out") {
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
    getTodayExpenses() {
        return this.db
            .prepare(`SELECT * FROM expenses 
         WHERE DATE(expense_date) = DATE('now')
         ORDER BY expense_date DESC`)
            .all();
    }
    /**
     * Get expense by ID
     */
    getExpenseById(id) {
        return this.db.prepare("SELECT * FROM expenses WHERE id = ?").get(id);
    }
    /**
     * Delete an expense by ID
     */
    deleteExpense(id) {
        this.db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
    }
    /**
     * Log activity for expense operations
     */
    logActivity(userId, action, details) {
        this.db
            .prepare(`INSERT INTO activity_logs (user_id, action, details_json, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
            .run(userId, action, JSON.stringify(details));
    }
}
// Singleton instance
let expenseRepositoryInstance = null;
export function getExpenseRepository() {
    if (!expenseRepositoryInstance) {
        expenseRepositoryInstance = new ExpenseRepository();
    }
    return expenseRepositoryInstance;
}
export function resetExpenseRepository() {
    expenseRepositoryInstance = null;
}

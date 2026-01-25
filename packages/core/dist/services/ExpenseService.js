import { getExpenseRepository, } from "../repositories/ExpenseRepository.js";
import { toErrorString } from "../utils/errors.js";
export class ExpenseService {
    repo;
    constructor() {
        this.repo = getExpenseRepository();
    }
    /**
     * Add a new expense
     */
    addExpense(data) {
        try {
            const id = this.repo.createExpense(data);
            // Log activity
            this.repo.logActivity(1, "Add Expense", {
                category: data.category,
                paid_by_method: data.paid_by_method || "CASH",
                expense_type: data.expense_type,
                amount_usd: data.amount_usd,
                amount_lbp: data.amount_lbp,
            });
            console.log(`[EXPENSE] Added: ${data.category} (${data.expense_type}) paid_by=${data.paid_by_method || "CASH"}`);
            return { success: true, id };
        }
        catch (error) {
            console.error("ExpenseService.addExpense error:", error);
            return { success: false, error: toErrorString(error) };
        }
    }
    /**
     * Get today's expenses
     */
    getTodayExpenses() {
        try {
            return this.repo.getTodayExpenses();
        }
        catch (error) {
            console.error("ExpenseService.getTodayExpenses error:", error);
            return [];
        }
    }
    /**
     * Delete an expense
     */
    deleteExpense(id) {
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
        }
        catch (error) {
            console.error("ExpenseService.deleteExpense error:", error);
            return { success: false, error: toErrorString(error) };
        }
    }
}
// Singleton instance
let expenseServiceInstance = null;
export function getExpenseService() {
    if (!expenseServiceInstance) {
        expenseServiceInstance = new ExpenseService();
    }
    return expenseServiceInstance;
}
export function resetExpenseService() {
    expenseServiceInstance = null;
}

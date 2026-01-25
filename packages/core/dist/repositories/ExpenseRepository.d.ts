import { BaseRepository } from "./BaseRepository.js";
export interface ExpenseEntity {
    id: number;
    description: string;
    category: string;
    expense_type: string;
    paid_by_method?: "CASH" | "OMT" | "WHISH" | "BINANCE";
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
    paid_by_method?: "CASH" | "OMT" | "WHISH" | "BINANCE";
    amount_usd: number;
    amount_lbp: number;
    expense_date: string;
}
export declare class ExpenseRepository extends BaseRepository<ExpenseEntity> {
    constructor();
    /**
     * Create a new expense
     */
    createExpense(data: CreateExpenseData): number;
    /**
     * Get today's expenses
     */
    getTodayExpenses(): ExpenseEntity[];
    /**
     * Get expense by ID
     */
    getExpenseById(id: number): ExpenseEntity | undefined;
    /**
     * Delete an expense by ID
     */
    deleteExpense(id: number): void;
    /**
     * Log activity for expense operations
     */
    logActivity(userId: number, action: string, details: Record<string, unknown>): void;
}
export declare function getExpenseRepository(): ExpenseRepository;
export declare function resetExpenseRepository(): void;

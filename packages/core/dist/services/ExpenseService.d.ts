import { ExpenseEntity, CreateExpenseData } from "../repositories/ExpenseRepository.js";
export interface ExpenseResult {
    success: boolean;
    id?: number;
    error?: string;
}
export declare class ExpenseService {
    private repo;
    constructor();
    /**
     * Add a new expense
     */
    addExpense(data: CreateExpenseData): ExpenseResult;
    /**
     * Get today's expenses
     */
    getTodayExpenses(): ExpenseEntity[];
    /**
     * Delete an expense
     */
    deleteExpense(id: number): ExpenseResult;
}
export declare function getExpenseService(): ExpenseService;
export declare function resetExpenseService(): void;

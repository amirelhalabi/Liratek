/**
 * Debt Service
 *
 * Business logic layer for debt operations.
 * Uses DebtRepository for data access.
 *
 * This service encapsulates:
 * - Debt queries and lookups
 * - Repayment processing
 * - Dashboard debt summaries
 */
import { DebtRepository, type DebtLedgerEntity, type DebtorSummary, type DebtSummary } from "../repositories/index.js";
export interface RepaymentResult {
    success: boolean;
    id?: number;
    error?: string;
}
export interface RepaymentData {
    clientId: number;
    amountUSD: number;
    amountLBP: number;
    note?: string;
    userId?: number;
}
export declare class DebtService {
    private debtRepo;
    constructor(debtRepo?: DebtRepository);
    /**
     * Get all clients with outstanding debt
     */
    getDebtors(): DebtorSummary[];
    /**
     * Get debt history for a specific client
     */
    getClientHistory(clientId: number): DebtLedgerEntity[];
    /**
     * Get total debt amount for a specific client
     */
    getClientTotal(clientId: number): number;
    /**
     * Process a debt repayment
     */
    addRepayment(data: RepaymentData): RepaymentResult;
    /**
     * Get debt summary for dashboard display
     */
    getDebtSummary(): DebtSummary;
}
export declare function getDebtService(): DebtService;
/** Reset the singleton (for testing) */
export declare function resetDebtService(): void;

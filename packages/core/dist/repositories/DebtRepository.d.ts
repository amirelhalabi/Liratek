/**
 * Debt Repository
 *
 * Handles all debt_ledger table operations.
 * Uses BaseRepository for common functionality.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface DebtLedgerEntity {
    id: number;
    client_id: number;
    sale_id: number | null;
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
    created_at: string;
    created_by: number | null;
}
export interface DebtorSummary {
    id: number;
    full_name: string;
    phone_number: string;
    total_debt: number;
}
export interface TopDebtor {
    full_name: string;
    total_debt: number;
}
export interface DebtSummary {
    totalDebt: number;
    topDebtors: TopDebtor[];
}
export interface CreateRepaymentData {
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    note?: string | null;
    created_by?: number | null;
}
export declare class DebtRepository extends BaseRepository<DebtLedgerEntity> {
    constructor();
    /**
     * Get all clients with their debt totals (grouped)
     */
    findAllDebtors(): DebtorSummary[];
    /**
     * Get debt history for a specific client
     * Default: most recent first (DESC)
     */
    findClientHistory(clientId: number): DebtLedgerEntity[];
    /**
     * Get total debt for a specific client
     */
    getClientDebtTotal(clientId: number): number;
    /**
     * Add a repayment entry (stored as negative values to reduce debt)
     */
    addRepayment(data: CreateRepaymentData): {
        id: number;
    };
    /**
     * Get debt summary for dashboard (total debt + top debtors)
     */
    getDebtSummary(topN?: number): DebtSummary;
}
export declare function getDebtRepository(): DebtRepository;
/** Reset the singleton (for testing) */
export declare function resetDebtRepository(): void;

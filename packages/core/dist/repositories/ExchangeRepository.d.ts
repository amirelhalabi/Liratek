/**
 * Exchange Repository
 *
 * Handles all exchange_transactions table operations.
 * Uses BaseRepository for common functionality.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface ExchangeTransactionEntity {
    id: number;
    type: string;
    from_currency: string;
    to_currency: string;
    amount_in: number;
    amount_out: number;
    rate: number;
    client_name: string | null;
    note: string | null;
    created_at: string;
    created_by: number | null;
}
export interface CreateExchangeData {
    fromCurrency: string;
    toCurrency: string;
    amountIn: number;
    amountOut: number;
    rate: number;
    clientName?: string;
    note?: string;
}
export declare class ExchangeRepository extends BaseRepository<ExchangeTransactionEntity> {
    constructor();
    /**
     * Create a new exchange transaction
     */
    createTransaction(data: CreateExchangeData): {
        id: number;
    };
    /**
     * Log the exchange activity
     */
    logActivity(data: CreateExchangeData): void;
    /**
     * Get recent exchange history (last N transactions)
     */
    getHistory(limit?: number): ExchangeTransactionEntity[];
    /**
     * Get today's exchange transactions
     */
    getTodayTransactions(): ExchangeTransactionEntity[];
    /**
     * Get exchange statistics for today
     */
    getTodayStats(): {
        totalIn: number;
        totalOut: number;
        count: number;
    };
}
export declare function getExchangeRepository(): ExchangeRepository;
/** Reset the singleton (for testing) */
export declare function resetExchangeRepository(): void;

/**
 * Exchange Service
 *
 * Business logic layer for currency exchange operations.
 * Uses ExchangeRepository for data access.
 */
import { ExchangeRepository, type ExchangeTransactionEntity, type CreateExchangeData } from "../repositories/index.js";
export interface ExchangeResult {
    success: boolean;
    id?: number;
    error?: string;
}
export declare class ExchangeService {
    private exchangeRepo;
    constructor(exchangeRepo?: ExchangeRepository);
    /**
     * Add a new exchange transaction
     */
    addTransaction(data: CreateExchangeData): ExchangeResult;
    /**
     * Get exchange transaction history
     */
    getHistory(limit?: number): ExchangeTransactionEntity[];
    /**
     * Get today's exchange transactions
     */
    getTodayTransactions(): ExchangeTransactionEntity[];
    /**
     * Get today's exchange statistics
     */
    getTodayStats(): {
        totalIn: number;
        totalOut: number;
        count: number;
    };
}
export declare function getExchangeService(): ExchangeService;
/** Reset the singleton (for testing) */
export declare function resetExchangeService(): void;

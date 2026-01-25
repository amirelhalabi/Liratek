/**
 * Financial Service (OMT/WHISH/BOB) Service
 *
 * Business logic layer for money transfer operations.
 * Uses FinancialServiceRepository for data access.
 */
import { FinancialServiceRepository, type FinancialServiceEntity, type CreateFinancialServiceData, type FinancialServiceAnalytics } from "../repositories/index.js";
export interface FinancialServiceResult {
    success: boolean;
    id?: number;
    error?: string;
}
export declare class FinancialService {
    private fsRepo;
    constructor(fsRepo?: FinancialServiceRepository);
    /**
     * Add a new financial service transaction (OMT, WHISH, BOB, etc.)
     */
    addTransaction(data: CreateFinancialServiceData): FinancialServiceResult;
    /**
     * Get transaction history, optionally filtered by provider
     */
    getHistory(provider?: string): FinancialServiceEntity[];
    /**
     * Get comprehensive analytics (today, month, by provider)
     */
    getAnalytics(): FinancialServiceAnalytics;
}
export declare function getFinancialService(): FinancialService;
/** Reset the singleton (for testing) */
export declare function resetFinancialService(): void;

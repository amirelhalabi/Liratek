/**
 * Currency Service
 *
 * Business logic layer for currency operations.
 */
import { CurrencyRepository, type CurrencyEntity, type CreateCurrencyData, type UpdateCurrencyData } from "../repositories/index.js";
export interface CurrencyResult {
    success: boolean;
    id?: number;
    error?: string;
}
export declare class CurrencyService {
    private currencyRepo;
    constructor(currencyRepo?: CurrencyRepository);
    /**
     * Get all currencies
     */
    listCurrencies(): CurrencyEntity[] | {
        error: string;
    };
    /**
     * Create a new currency
     */
    createCurrency(data: CreateCurrencyData): CurrencyResult;
    /**
     * Update a currency
     */
    updateCurrency(id: number, data: UpdateCurrencyData): CurrencyResult;
    /**
     * Delete a currency
     */
    deleteCurrency(id: number): CurrencyResult;
}
export declare function getCurrencyService(): CurrencyService;
/** Reset the singleton (for testing) */
export declare function resetCurrencyService(): void;

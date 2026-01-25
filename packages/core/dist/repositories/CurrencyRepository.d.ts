/**
 * Currency Repository
 *
 * Handles all currencies table operations.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface CurrencyEntity {
    id: number;
    code: string;
    name: string;
    is_active: number;
}
export interface CreateCurrencyData {
    code: string;
    name: string;
}
export interface UpdateCurrencyData {
    code?: string;
    name?: string;
    is_active?: number;
}
export declare class CurrencyRepository extends BaseRepository<CurrencyEntity> {
    constructor();
    /**
     * Get all currencies
     */
    findAllCurrencies(): CurrencyEntity[];
    /**
     * Create a new currency
     */
    createCurrency(data: CreateCurrencyData): {
        id: number;
    };
    /**
     * Update a currency
     */
    updateCurrency(id: number, data: UpdateCurrencyData): boolean;
    /**
     * Delete a currency
     */
    deleteCurrency(id: number): void;
    /**
     * Check if currency code exists
     */
    codeExists(code: string, excludeId?: number): boolean;
}
export declare function getCurrencyRepository(): CurrencyRepository;
/** Reset the singleton (for testing) */
export declare function resetCurrencyRepository(): void;

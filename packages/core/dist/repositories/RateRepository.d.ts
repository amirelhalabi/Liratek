/**
 * Rate Repository
 *
 * Handles all exchange_rates table operations.
 */
import { BaseRepository } from "./BaseRepository.js";
export interface ExchangeRateEntity {
    id: number;
    from_code: string;
    to_code: string;
    rate: number;
    updated_at: string;
}
export interface SetRateData {
    from_code: string;
    to_code: string;
    rate: number;
}
export declare class RateRepository extends BaseRepository<ExchangeRateEntity> {
    constructor();
    /**
     * Get all exchange rates
     */
    findAllRates(): ExchangeRateEntity[];
    /**
     * Set or update an exchange rate (upsert)
     */
    setRate(data: SetRateData): void;
    /**
     * Get a specific rate
     */
    getRate(fromCode: string, toCode: string): number | null;
}
export declare function getRateRepository(): RateRepository;
/** Reset the singleton (for testing) */
export declare function resetRateRepository(): void;

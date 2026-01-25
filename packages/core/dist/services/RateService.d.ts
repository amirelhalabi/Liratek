/**
 * Rate Service
 *
 * Business logic layer for exchange rate operations.
 */
import { RateRepository, type ExchangeRateEntity, type SetRateData } from "../repositories/index.js";
export interface RateResult {
    success: boolean;
    error?: string;
}
export declare class RateService {
    private rateRepo;
    constructor(rateRepo?: RateRepository);
    /**
     * Get all exchange rates
     */
    listRates(): ExchangeRateEntity[] | {
        error: string;
    };
    /**
     * Set or update an exchange rate
     */
    setRate(data: SetRateData): RateResult;
    /**
     * Get a specific rate
     */
    getRate(fromCode: string, toCode: string): number | null;
}
export declare function getRateService(): RateService;
/** Reset the singleton (for testing) */
export declare function resetRateService(): void;

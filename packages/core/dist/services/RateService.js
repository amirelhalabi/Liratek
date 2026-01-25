/**
 * Rate Service
 *
 * Business logic layer for exchange rate operations.
 */
import { getRateRepository, } from "../repositories/index.js";
import { toErrorString } from "../utils/errors.js";
// =============================================================================
// Rate Service Class
// =============================================================================
export class RateService {
    rateRepo;
    constructor(rateRepo) {
        this.rateRepo = rateRepo ?? getRateRepository();
    }
    /**
     * Get all exchange rates
     */
    listRates() {
        try {
            return this.rateRepo.findAllRates();
        }
        catch (e) {
            return { error: toErrorString(e) };
        }
    }
    /**
     * Set or update an exchange rate
     */
    setRate(data) {
        try {
            this.rateRepo.setRate(data);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: toErrorString(e) };
        }
    }
    /**
     * Get a specific rate
     */
    getRate(fromCode, toCode) {
        return this.rateRepo.getRate(fromCode, toCode);
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let rateServiceInstance = null;
export function getRateService() {
    if (!rateServiceInstance) {
        rateServiceInstance = new RateService();
    }
    return rateServiceInstance;
}
/** Reset the singleton (for testing) */
export function resetRateService() {
    rateServiceInstance = null;
}

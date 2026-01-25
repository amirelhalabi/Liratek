/**
 * Currency Service
 *
 * Business logic layer for currency operations.
 */
import { getCurrencyRepository, } from "../repositories/index.js";
import { toErrorString, getRepoConstraintCode } from "../utils/errors.js";
// =============================================================================
// Currency Service Class
// =============================================================================
export class CurrencyService {
    currencyRepo;
    constructor(currencyRepo) {
        this.currencyRepo = currencyRepo ?? getCurrencyRepository();
    }
    /**
     * Get all currencies
     */
    listCurrencies() {
        try {
            return this.currencyRepo.findAllCurrencies();
        }
        catch (e) {
            return { error: toErrorString(e) };
        }
    }
    /**
     * Create a new currency
     */
    createCurrency(data) {
        try {
            const result = this.currencyRepo.createCurrency(data);
            return { success: true, id: result.id };
        }
        catch (e) {
            const sqliteCode = e?.code;
            if (getRepoConstraintCode(e) === "DUPLICATE_CURRENCY_CODE" ||
                sqliteCode === "SQLITE_CONSTRAINT_UNIQUE") {
                return { success: false, error: "Currency code already exists" };
            }
            return { success: false, error: toErrorString(e) };
        }
    }
    /**
     * Update a currency
     */
    updateCurrency(id, data) {
        try {
            const updated = this.currencyRepo.updateCurrency(id, data);
            if (!updated) {
                return { success: false, error: "Not found" };
            }
            return { success: true };
        }
        catch (e) {
            return { success: false, error: toErrorString(e) };
        }
    }
    /**
     * Delete a currency
     */
    deleteCurrency(id) {
        try {
            this.currencyRepo.deleteCurrency(id);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: toErrorString(e) };
        }
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let currencyServiceInstance = null;
export function getCurrencyService() {
    if (!currencyServiceInstance) {
        currencyServiceInstance = new CurrencyService();
    }
    return currencyServiceInstance;
}
/** Reset the singleton (for testing) */
export function resetCurrencyService() {
    currencyServiceInstance = null;
}

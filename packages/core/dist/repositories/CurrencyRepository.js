/**
 * Currency Repository
 *
 * Handles all currencies table operations.
 */
import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
// =============================================================================
// Currency Repository Class
// =============================================================================
export class CurrencyRepository extends BaseRepository {
    constructor() {
        super("currencies", { softDelete: false });
    }
    /**
     * Get all currencies
     */
    findAllCurrencies() {
        const stmt = this.db.prepare("SELECT id, code, name, is_active FROM currencies ORDER BY code ASC");
        return stmt.all();
    }
    /**
     * Create a new currency
     */
    createCurrency(data) {
        try {
            const stmt = this.db.prepare("INSERT INTO currencies (code, name, is_active) VALUES (?, ?, 1)");
            const result = stmt.run(data.code.toUpperCase(), data.name);
            return { id: Number(result.lastInsertRowid) };
        }
        catch (error) {
            const code = error?.code;
            if (code === "SQLITE_CONSTRAINT_UNIQUE") {
                throw new DatabaseError("Currency code already exists", {
                    code: "DUPLICATE_CURRENCY_CODE",
                    cause: error,
                });
            }
            throw error;
        }
    }
    /**
     * Update a currency
     */
    updateCurrency(id, data) {
        const current = this.findById(id);
        if (!current)
            return false;
        const code = (data.code ?? current.code).toUpperCase();
        const name = data.name ?? current.name;
        const isActive = data.is_active ?? current.is_active;
        this.db
            .prepare("UPDATE currencies SET code = ?, name = ?, is_active = ? WHERE id = ?")
            .run(code, name, isActive, id);
        return true;
    }
    /**
     * Delete a currency
     */
    deleteCurrency(id) {
        this.db.prepare("DELETE FROM currencies WHERE id = ?").run(id);
    }
    /**
     * Check if currency code exists
     */
    codeExists(code, excludeId) {
        let query = "SELECT 1 FROM currencies WHERE code = ?";
        const params = [code.toUpperCase()];
        if (excludeId) {
            query += " AND id != ?";
            params.push(excludeId);
        }
        return !!this.db.prepare(query).get(...params);
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let currencyRepositoryInstance = null;
export function getCurrencyRepository() {
    if (!currencyRepositoryInstance) {
        currencyRepositoryInstance = new CurrencyRepository();
    }
    return currencyRepositoryInstance;
}
/** Reset the singleton (for testing) */
export function resetCurrencyRepository() {
    currencyRepositoryInstance = null;
}

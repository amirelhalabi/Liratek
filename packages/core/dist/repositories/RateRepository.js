/**
 * Rate Repository
 *
 * Handles all exchange_rates table operations.
 */
import { BaseRepository } from "./BaseRepository.js";
// =============================================================================
// Rate Repository Class
// =============================================================================
export class RateRepository extends BaseRepository {
    constructor() {
        super("exchange_rates", { softDelete: false });
    }
    /**
     * Get all exchange rates
     */
    findAllRates() {
        const stmt = this.db.prepare("SELECT id, from_code, to_code, rate, updated_at FROM exchange_rates ORDER BY from_code, to_code");
        return stmt.all();
    }
    /**
     * Set or update an exchange rate (upsert)
     */
    setRate(data) {
        const stmt = this.db.prepare(`
      INSERT INTO exchange_rates (from_code, to_code, rate) VALUES (?, ?, ?)
      ON CONFLICT(from_code, to_code) DO UPDATE SET rate=excluded.rate, updated_at=CURRENT_TIMESTAMP
    `);
        stmt.run(data.from_code.toUpperCase(), data.to_code.toUpperCase(), data.rate);
    }
    /**
     * Get a specific rate
     */
    getRate(fromCode, toCode) {
        const stmt = this.db.prepare("SELECT rate FROM exchange_rates WHERE from_code = ? AND to_code = ?");
        const result = stmt.get(fromCode.toUpperCase(), toCode.toUpperCase());
        return result?.rate ?? null;
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let rateRepositoryInstance = null;
export function getRateRepository() {
    if (!rateRepositoryInstance) {
        rateRepositoryInstance = new RateRepository();
    }
    return rateRepositoryInstance;
}
/** Reset the singleton (for testing) */
export function resetRateRepository() {
    rateRepositoryInstance = null;
}

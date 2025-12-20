/**
 * Rate Repository
 * 
 * Handles all exchange_rates table operations.
 */

import { BaseRepository } from './BaseRepository';

// =============================================================================
// Entity Types
// =============================================================================

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

// =============================================================================
// Rate Repository Class
// =============================================================================

export class RateRepository extends BaseRepository<ExchangeRateEntity> {
  constructor() {
    super('exchange_rates', { softDelete: false });
  }

  /**
   * Get all exchange rates
   */
  findAllRates(): ExchangeRateEntity[] {
    const stmt = this.db.prepare(
      'SELECT id, from_code, to_code, rate, updated_at FROM exchange_rates ORDER BY from_code, to_code'
    );
    return stmt.all() as ExchangeRateEntity[];
  }

  /**
   * Set or update an exchange rate (upsert)
   */
  setRate(data: SetRateData): void {
    const stmt = this.db.prepare(`
      INSERT INTO exchange_rates (from_code, to_code, rate) VALUES (?, ?, ?)
      ON CONFLICT(from_code, to_code) DO UPDATE SET rate=excluded.rate, updated_at=CURRENT_TIMESTAMP
    `);
    stmt.run(data.from_code.toUpperCase(), data.to_code.toUpperCase(), data.rate);
  }

  /**
   * Get a specific rate
   */
  getRate(fromCode: string, toCode: string): number | null {
    const stmt = this.db.prepare(
      'SELECT rate FROM exchange_rates WHERE from_code = ? AND to_code = ?'
    );
    const result = stmt.get(fromCode.toUpperCase(), toCode.toUpperCase()) as { rate: number } | undefined;
    return result?.rate ?? null;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rateRepositoryInstance: RateRepository | null = null;

export function getRateRepository(): RateRepository {
  if (!rateRepositoryInstance) {
    rateRepositoryInstance = new RateRepository();
  }
  return rateRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetRateRepository(): void {
  rateRepositoryInstance = null;
}

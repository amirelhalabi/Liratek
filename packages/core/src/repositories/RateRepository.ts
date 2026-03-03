/**
 * Rate Repository
 *
 * Handles all exchange_rates table operations.
 * New schema (v30): one row per non-USD currency
 *   (to_code, market_rate, delta, is_stronger)
 */

import { BaseRepository } from "./BaseRepository.js";
import type { CurrencyRate } from "../utils/currencyConverter.js";
import type { SetRateData } from "../validators/rate.js";

// Re-export for consumers
export type { SetRateData };

// =============================================================================
// Entity Types
// =============================================================================

export interface ExchangeRateEntity {
  id: number;
  to_code: string;
  market_rate: number;
  delta: number;
  is_stronger: 1 | -1;
  updated_at: string;
}

// =============================================================================
// Rate Repository Class
// =============================================================================

export class RateRepository extends BaseRepository<ExchangeRateEntity> {
  constructor() {
    super("exchange_rates", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, to_code, market_rate, delta, is_stronger, updated_at";
  }

  /**
   * Get all exchange rates as CurrencyRate[] (ready for currencyConverter)
   */
  findAll(): ExchangeRateEntity[] {
    return this.db
      .prepare(
        "SELECT id, to_code, market_rate, delta, is_stronger, updated_at FROM exchange_rates ORDER BY to_code",
      )
      .all() as ExchangeRateEntity[];
  }

  /**
   * Get all rates in CurrencyRate format (for use with calculateExchange)
   */
  findAllAsCurrencyRates(): CurrencyRate[] {
    return this.findAll().map((r) => ({
      to_code: r.to_code,
      market_rate: r.market_rate,
      delta: r.delta,
      is_stronger: r.is_stronger,
    }));
  }

  /**
   * Get rate for a specific currency code
   */
  findByCode(code: string): ExchangeRateEntity | null {
    return (
      (this.db
        .prepare(
          "SELECT id, to_code, market_rate, delta, is_stronger, updated_at FROM exchange_rates WHERE to_code = ?",
        )
        .get(code.toUpperCase()) as ExchangeRateEntity | undefined) ?? null
    );
  }

  /**
   * Upsert a rate entry (insert or update by to_code)
   */
  upsert(data: SetRateData): void {
    this.db
      .prepare(
        `INSERT INTO exchange_rates (to_code, market_rate, delta, is_stronger)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(to_code) DO UPDATE SET
           market_rate = excluded.market_rate,
           delta       = excluded.delta,
           is_stronger = excluded.is_stronger,
           updated_at  = datetime('now')`,
      )
      .run(
        data.to_code.toUpperCase(),
        data.market_rate,
        data.delta,
        data.is_stronger,
      );
  }

  /**
   * Delete rate for a currency
   */
  deleteByCode(code: string): void {
    this.db
      .prepare("DELETE FROM exchange_rates WHERE to_code = ?")
      .run(code.toUpperCase());
  }

  // ── Legacy compatibility shims (used by old callers during transition) ──────

  /**
   * @deprecated Use findAllAsCurrencyRates() instead
   */
  findAllRates(): ExchangeRateEntity[] {
    return this.findAll();
  }

  /**
   * @deprecated Use upsert() with new schema
   */
  setRate(data: {
    from_code: string;
    to_code: string;
    rate: number;
    base_rate?: number;
  }): void {
    // Derive new schema values from old-style call
    // This shim handles callers that haven't been updated yet
    const isLBP = data.to_code === "LBP" || data.from_code === "LBP";
    const currencyCode = isLBP
      ? "LBP"
      : data.from_code === "USD"
        ? data.to_code
        : data.from_code;
    const isStronger: 1 | -1 = currencyCode === "LBP" ? 1 : -1;
    const market = data.base_rate ?? data.rate;
    const delta = Math.abs(data.rate - market);
    this.upsert({
      to_code: currencyCode,
      market_rate: market,
      delta,
      is_stronger: isStronger,
    });
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

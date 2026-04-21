/**
 * Rate Repository
 *
 * Handles all exchange_rates table operations.
 * Schema (v59): one row per non-USD currency
 *   (to_code, market_rate, buy_rate, sell_rate, is_stronger)
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
  buy_rate: number;
  sell_rate: number;
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
    return "id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at";
  }

  /**
   * Get all exchange rates
   */
  findAll(): ExchangeRateEntity[] {
    return this.db
      .prepare(
        "SELECT id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at FROM exchange_rates ORDER BY to_code",
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
      buy_rate: r.buy_rate,
      sell_rate: r.sell_rate,
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
          "SELECT id, to_code, market_rate, buy_rate, sell_rate, is_stronger, updated_at FROM exchange_rates WHERE to_code = ?",
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
        `INSERT INTO exchange_rates (to_code, market_rate, buy_rate, sell_rate, is_stronger)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(to_code) DO UPDATE SET
           market_rate = excluded.market_rate,
           buy_rate    = excluded.buy_rate,
           sell_rate   = excluded.sell_rate,
           is_stronger = excluded.is_stronger,
           updated_at  = datetime('now')`,
      )
      .run(
        data.to_code.toUpperCase(),
        data.market_rate,
        data.buy_rate,
        data.sell_rate,
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

  /**
   * @deprecated Use findAllAsCurrencyRates() instead
   */
  findAllRates(): ExchangeRateEntity[] {
    return this.findAll();
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

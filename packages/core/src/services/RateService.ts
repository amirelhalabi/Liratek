/**
 * Rate Service
 *
 * Business logic layer for exchange rate operations.
 */

import {
  RateRepository,
  getRateRepository,
  type ExchangeRateEntity,
  type SetRateData,
} from "../repositories/index.js";
import { toErrorString } from "../utils/errors.js";

// =============================================================================
// Types
// =============================================================================

export interface RateResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Rate Service Class
// =============================================================================

export class RateService {
  private rateRepo: RateRepository;

  constructor(rateRepo?: RateRepository) {
    this.rateRepo = rateRepo ?? getRateRepository();
  }

  /**
   * Get all exchange rates
   */
  listRates(): ExchangeRateEntity[] | { error: string } {
    try {
      return this.rateRepo.findAllRates();
    } catch (e) {
      return { error: toErrorString(e) };
    }
  }

  /**
   * Set or update an exchange rate (new 4-column schema)
   */
  setRate(data: SetRateData): RateResult {
    try {
      this.rateRepo.upsert(data);
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * Get a specific rate
   */
  getRate(fromCode: string, toCode: string): number | null {
    // Handle USD conversions: the non-USD currency code is what we look up
    const code = fromCode === "USD" ? toCode : fromCode;
    const rateEntity = this.rateRepo.findByCode(code);
    if (!rateEntity) return null;
    return rateEntity.market_rate;
  }

  /**
   * Delete an exchange rate
   */
  deleteRate(fromCode: string, toCode: string): RateResult {
    try {
      // Handle USD conversions: the non-USD currency code is what we delete
      const code = fromCode === "USD" ? toCode : fromCode;
      this.rateRepo.deleteByCode(code);
      return { success: true };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rateServiceInstance: RateService | null = null;

export function getRateService(): RateService {
  if (!rateServiceInstance) {
    rateServiceInstance = new RateService();
  }
  return rateServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetRateService(): void {
  rateServiceInstance = null;
}

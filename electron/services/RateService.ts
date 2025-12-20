/**
 * Rate Service
 * 
 * Business logic layer for exchange rate operations.
 */

import { 
  RateRepository, 
  getRateRepository,
  type ExchangeRateEntity,
  type SetRateData
} from '../database/repositories';

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
    } catch (e: any) {
      return { error: e.message };
    }
  }

  /**
   * Set or update an exchange rate
   */
  setRate(data: SetRateData): RateResult {
    try {
      this.rateRepo.setRate(data);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get a specific rate
   */
  getRate(fromCode: string, toCode: string): number | null {
    return this.rateRepo.getRate(fromCode, toCode);
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

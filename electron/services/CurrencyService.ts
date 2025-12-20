/**
 * Currency Service
 * 
 * Business logic layer for currency operations.
 */

import { 
  CurrencyRepository, 
  getCurrencyRepository,
  type CurrencyEntity,
  type CreateCurrencyData,
  type UpdateCurrencyData
} from '../database/repositories';

// =============================================================================
// Types
// =============================================================================

export interface CurrencyResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Currency Service Class
// =============================================================================

export class CurrencyService {
  private currencyRepo: CurrencyRepository;

  constructor(currencyRepo?: CurrencyRepository) {
    this.currencyRepo = currencyRepo ?? getCurrencyRepository();
  }

  /**
   * Get all currencies
   */
  listCurrencies(): CurrencyEntity[] | { error: string } {
    try {
      return this.currencyRepo.findAllCurrencies();
    } catch (e: any) {
      return { error: e.message };
    }
  }

  /**
   * Create a new currency
   */
  createCurrency(data: CreateCurrencyData): CurrencyResult {
    try {
      const result = this.currencyRepo.createCurrency(data);
      return { success: true, id: result.id };
    } catch (e: any) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { success: false, error: 'Currency code already exists' };
      }
      return { success: false, error: e.message };
    }
  }

  /**
   * Update a currency
   */
  updateCurrency(id: number, data: UpdateCurrencyData): CurrencyResult {
    try {
      const updated = this.currencyRepo.updateCurrency(id, data);
      if (!updated) {
        return { success: false, error: 'Not found' };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Delete a currency
   */
  deleteCurrency(id: number): CurrencyResult {
    try {
      this.currencyRepo.deleteCurrency(id);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let currencyServiceInstance: CurrencyService | null = null;

export function getCurrencyService(): CurrencyService {
  if (!currencyServiceInstance) {
    currencyServiceInstance = new CurrencyService();
  }
  return currencyServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetCurrencyService(): void {
  currencyServiceInstance = null;
}

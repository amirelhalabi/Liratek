/**
 * Exchange Service
 * 
 * Business logic layer for currency exchange operations.
 * Uses ExchangeRepository for data access.
 */

import { 
  ExchangeRepository, 
  getExchangeRepository,
  type ExchangeTransactionEntity,
  type CreateExchangeData
} from '../database/repositories';

// =============================================================================
// Types
// =============================================================================

export interface ExchangeResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Exchange Service Class
// =============================================================================

export class ExchangeService {
  private exchangeRepo: ExchangeRepository;

  constructor(exchangeRepo?: ExchangeRepository) {
    this.exchangeRepo = exchangeRepo ?? getExchangeRepository();
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a new exchange transaction
   */
  addTransaction(data: CreateExchangeData): ExchangeResult {
    try {
      const result = this.exchangeRepo.createTransaction(data);
      
      // Log the activity
      this.exchangeRepo.logActivity(data);

      console.log(
        `[EXCHANGE] ${data.fromCurrency} -> ${data.toCurrency}: ${data.amountIn} -> ${data.amountOut} (Rate: ${data.rate}) [Drawer B]`
      );

      return { success: true, id: result.id };
    } catch (error) {
      console.error('Failed to add exchange transaction:', error);
      return { success: false, error: (error instanceof Error ? error.message : String(error)) };
    }
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get exchange transaction history
   */
  getHistory(limit: number = 50): ExchangeTransactionEntity[] {
    try {
      return this.exchangeRepo.getHistory(limit);
    } catch (error) {
      console.error('Failed to get exchange history:', error);
      return [];
    }
  }

  /**
   * Get today's exchange transactions
   */
  getTodayTransactions(): ExchangeTransactionEntity[] {
    return this.exchangeRepo.getTodayTransactions();
  }

  /**
   * Get today's exchange statistics
   */
  getTodayStats() {
    return this.exchangeRepo.getTodayStats();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let exchangeServiceInstance: ExchangeService | null = null;

export function getExchangeService(): ExchangeService {
  if (!exchangeServiceInstance) {
    exchangeServiceInstance = new ExchangeService();
  }
  return exchangeServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetExchangeService(): void {
  exchangeServiceInstance = null;
}

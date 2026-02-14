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
  type CreateExchangeData,
} from "../repositories/index.js";
import { exchangeLogger } from "../utils/logger.js";

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

      exchangeLogger.info(
        {
          id: result.id,
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          amountIn: data.amountIn,
          amountOut: data.amountOut,
          rate: data.rate,
        },
        `${data.fromCurrency} -> ${data.toCurrency}: ${data.amountIn} -> ${data.amountOut} (Rate: ${data.rate})`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      exchangeLogger.error(
        { error, data },
        "Failed to add exchange transaction",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
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
      exchangeLogger.error({ error, limit }, "Failed to get exchange history");
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

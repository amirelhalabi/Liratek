/**
 * Binance Service
 *
 * Business logic layer for Binance transfer operations.
 * Uses BinanceRepository for data access.
 */

import {
  BinanceRepository,
  getBinanceRepository,
  type BinanceTransactionEntity,
  type CreateBinanceTransactionData,
  type BinanceTodayStats,
} from "../repositories/index.js";

// =============================================================================
// Types
// =============================================================================

export interface BinanceResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Binance Service Class
// =============================================================================

export class BinanceService {
  private binanceRepo: BinanceRepository;

  constructor(binanceRepo?: BinanceRepository) {
    this.binanceRepo = binanceRepo ?? getBinanceRepository();
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a new Binance send/receive transaction
   */
  addTransaction(data: CreateBinanceTransactionData): BinanceResult {
    try {
      const result = this.binanceRepo.createTransaction(data);
      this.binanceRepo.logActivity(data);

      console.log(
        `[BINANCE] ${data.type}: ${data.amount} ${data.currencyCode || "USDT"} – ${data.description || "no description"}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      console.error("Failed to add Binance transaction:", error);
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
   * Get transaction history
   */
  getHistory(limit: number = 50): BinanceTransactionEntity[] {
    try {
      return this.binanceRepo.getHistory(limit);
    } catch (error) {
      console.error("Failed to get Binance history:", error);
      return [];
    }
  }

  /**
   * Get today's transactions
   */
  getTodayTransactions(): BinanceTransactionEntity[] {
    return this.binanceRepo.getTodayTransactions();
  }

  /**
   * Get today's stats
   */
  getTodayStats(): BinanceTodayStats {
    return this.binanceRepo.getTodayStats();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let binanceServiceInstance: BinanceService | null = null;

export function getBinanceService(): BinanceService {
  if (!binanceServiceInstance) {
    binanceServiceInstance = new BinanceService();
  }
  return binanceServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetBinanceService(): void {
  binanceServiceInstance = null;
}

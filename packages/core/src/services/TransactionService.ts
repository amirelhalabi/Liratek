/**
 * Transaction Service
 *
 * Thin service layer over TransactionRepository. Provides the public API
 * for creating, querying, voiding, and refunding unified transactions.
 */

import type { TransactionType } from "../constants/transactionTypes.js";
import {
  type CreateTransactionInput,
  type DailySummary,
  type DebtAgingBuckets,
  type OverdueDebtEntry,
  type TransactionEntity,
  type TransactionFilters,
  type TransactionWithUser,
  TransactionRepository,
  getTransactionRepository,
} from "../repositories/TransactionRepository.js";
import { getRateRepository } from "../repositories/RateRepository.js";
import logger from "../utils/logger.js";

export class TransactionService {
  private repo: TransactionRepository;

  constructor(repo?: TransactionRepository) {
    this.repo = repo ?? getTransactionRepository();
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Create a transaction, automatically snapshotting the current exchange rate
   * if none is provided.
   */
  createTransaction(data: CreateTransactionInput): number {
    try {
      // Snapshot exchange rate if not explicitly provided
      if (data.exchange_rate === undefined) {
        data = { ...data, exchange_rate: this.snapshotExchangeRate() };
      }
      return this.repo.createTransaction(data);
    } catch (error) {
      logger.error(
        { error, data },
        "TransactionService.createTransaction error",
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  getRecent(
    limit?: number,
    filters?: TransactionFilters,
  ): TransactionWithUser[] {
    try {
      return this.repo.getRecent(limit, filters);
    } catch (error) {
      logger.error({ error }, "TransactionService.getRecent error");
      return [];
    }
  }

  getById(id: number): TransactionEntity | null {
    try {
      return this.repo.findById(id);
    } catch (error) {
      logger.error({ error, id }, "TransactionService.getById error");
      return null;
    }
  }

  getBySourceId(
    sourceTable: string,
    sourceId: number,
  ): TransactionEntity | null {
    try {
      return this.repo.getBySourceId(sourceTable, sourceId);
    } catch (error) {
      logger.error(
        { error, sourceTable, sourceId },
        "TransactionService.getBySourceId error",
      );
      return null;
    }
  }

  getByClientId(clientId: number, limit?: number): TransactionEntity[] {
    try {
      return this.repo.getByClientId(clientId, limit);
    } catch (error) {
      logger.error(
        { error, clientId },
        "TransactionService.getByClientId error",
      );
      return [];
    }
  }

  getByDateRange(
    from: string,
    to: string,
    type?: TransactionType,
  ): TransactionEntity[] {
    try {
      return this.repo.getByDateRange(from, to, type);
    } catch (error) {
      logger.error({ error }, "TransactionService.getByDateRange error");
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Accounting Journal Operations
  // ---------------------------------------------------------------------------

  /**
   * Void a transaction: marks the original as VOIDED and creates a reversal row.
   * Returns the reversal transaction ID.
   */
  voidTransaction(id: number, userId: number): number {
    try {
      return this.repo.voidTransaction(id, userId);
    } catch (error) {
      logger.error(
        { error, id, userId },
        "TransactionService.voidTransaction error",
      );
      throw error;
    }
  }

  /**
   * Refund a sale by its sale ID. Resolves the transaction internally.
   */
  refundBySaleId(saleId: number, userId: number): number {
    try {
      return this.repo.refundBySaleId(saleId, userId);
    } catch (error) {
      logger.error(
        { error, saleId, userId },
        "TransactionService.refundBySaleId error",
      );
      throw error;
    }
  }

  /**
   * Create a refund for a transaction. Original stays ACTIVE.
   * Returns the refund transaction ID.
   */
  refundTransaction(id: number, userId: number): number {
    try {
      return this.repo.refundTransaction(id, userId);
    } catch (error) {
      logger.error(
        { error, id, userId },
        "TransactionService.refundTransaction error",
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  getDailySummary(date: string): DailySummary {
    try {
      return this.repo.getDailySummary(date);
    } catch (error) {
      logger.error({ error, date }, "TransactionService.getDailySummary error");
      return {
        date,
        total_usd: 0,
        total_lbp: 0,
        by_type: [],
        void_count: 0,
        void_usd: 0,
        void_lbp: 0,
      };
    }
  }

  getClientDebtAging(clientId: number): DebtAgingBuckets {
    try {
      return this.repo.getClientDebtAging(clientId);
    } catch (error) {
      logger.error(
        { error, clientId },
        "TransactionService.getClientDebtAging error",
      );
      return {
        client_id: clientId,
        current: { usd: 0, lbp: 0 },
        days_31_60: { usd: 0, lbp: 0 },
        days_61_90: { usd: 0, lbp: 0 },
        over_90: { usd: 0, lbp: 0 },
      };
    }
  }

  getOverdueDebts(): OverdueDebtEntry[] {
    try {
      return this.repo.getOverdueDebts();
    } catch (error) {
      logger.error({ error }, "TransactionService.getOverdueDebts error");
      return [];
    }
  }

  getRevenueByType(
    from: string,
    to: string,
  ): Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    try {
      return this.repo.getRevenueByType(from, to);
    } catch (error) {
      logger.error({ error }, "TransactionService.getRevenueByType error");
      return [];
    }
  }

  getRevenueByUser(
    from: string,
    to: string,
  ): Array<{
    user_id: number;
    username: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }> {
    try {
      return this.repo.getRevenueByUser(from, to);
    } catch (error) {
      logger.error({ error }, "TransactionService.getRevenueByUser error");
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Snapshot the current USD→LBP exchange rate.
   * Returns null if no rate is configured (non-fatal).
   */
  private snapshotExchangeRate(): number | null {
    try {
      const rateEntity = getRateRepository().findByCode("LBP");
      return rateEntity ? rateEntity.market_rate : null;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let transactionServiceInstance: TransactionService | null = null;

export function getTransactionService(): TransactionService {
  if (!transactionServiceInstance) {
    transactionServiceInstance = new TransactionService();
  }
  return transactionServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetTransactionService(): void {
  transactionServiceInstance = null;
}

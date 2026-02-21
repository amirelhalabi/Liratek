/**
 * Reporting Service
 *
 * Provides high-level reporting methods for financial analytics,
 * client histories, and per-period summaries built on the unified
 * transactions table.
 */

import { getTransactionRepository } from "../repositories/TransactionRepository.js";
import type {
  TransactionEntity,
  DailySummary,
  DebtAgingBuckets,
  OverdueDebtEntry,
} from "../repositories/TransactionRepository.js";
import logger from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface PeriodSummary {
  period: string; // e.g. "2025-01-15", "2025-W03", "2025-01"
  total_usd: number;
  total_lbp: number;
  transaction_count: number;
  by_type: Array<{
    type: string;
    count: number;
    total_usd: number;
    total_lbp: number;
  }>;
  void_count: number;
}

export interface ClientHistory {
  client_id: number;
  transactions: TransactionEntity[];
  debt_aging: DebtAgingBuckets;
  running_balance_usd: number;
  running_balance_lbp: number;
}

// =============================================================================
// Service
// =============================================================================

export class ReportingService {
  /**
   * Get daily summaries for a date range.
   */
  getDailySummaries(from: string, to: string): DailySummary[] {
    try {
      const repo = getTransactionRepository();
      const dates = this.getDateRange(from, to);
      return dates.map((d) => repo.getDailySummary(d));
    } catch (error) {
      logger.error({ error }, "ReportingService.getDailySummaries error");
      return [];
    }
  }

  /**
   * Get full client transaction history with running balance.
   */
  getClientHistory(clientId: number, limit = 500): ClientHistory {
    try {
      const repo = getTransactionRepository();
      const transactions = repo.getByClientId(clientId, limit);
      const debtAging = repo.getClientDebtAging(clientId);

      // Compute running balance from all ACTIVE transactions
      let runningUsd = 0;
      let runningLbp = 0;
      for (const txn of transactions) {
        if (txn.status === "ACTIVE") {
          runningUsd += txn.amount_usd;
          runningLbp += txn.amount_lbp;
        }
      }

      return {
        client_id: clientId,
        transactions,
        debt_aging: debtAging,
        running_balance_usd: runningUsd,
        running_balance_lbp: runningLbp,
      };
    } catch (error) {
      logger.error(
        { error, clientId },
        "ReportingService.getClientHistory error",
      );
      return {
        client_id: clientId,
        transactions: [],
        debt_aging: {
          client_id: clientId,
          current: { usd: 0, lbp: 0 },
          days_31_60: { usd: 0, lbp: 0 },
          days_61_90: { usd: 0, lbp: 0 },
          over_90: { usd: 0, lbp: 0 },
        },
        running_balance_usd: 0,
        running_balance_lbp: 0,
      };
    }
  }

  /**
   * Revenue by module for a date range.
   */
  getRevenueByModule(from: string, to: string) {
    try {
      return getTransactionRepository().getRevenueByType(from, to);
    } catch (error) {
      logger.error({ error }, "ReportingService.getRevenueByModule error");
      return [];
    }
  }

  /**
   * Revenue by user for a date range.
   */
  getRevenueByUser(from: string, to: string) {
    try {
      return getTransactionRepository().getRevenueByUser(from, to);
    } catch (error) {
      logger.error({ error }, "ReportingService.getRevenueByUser error");
      return [];
    }
  }

  /**
   * All overdue debts across all clients.
   */
  getOverdueDebts(): OverdueDebtEntry[] {
    try {
      return getTransactionRepository().getOverdueDebts();
    } catch (error) {
      logger.error({ error }, "ReportingService.getOverdueDebts error");
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getDateRange(from: string, to: string): string[] {
    const dates: string[] = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let reportingServiceInstance: ReportingService | null = null;

export function getReportingService(): ReportingService {
  if (!reportingServiceInstance) {
    reportingServiceInstance = new ReportingService();
  }
  return reportingServiceInstance;
}

export function resetReportingService(): void {
  reportingServiceInstance = null;
}

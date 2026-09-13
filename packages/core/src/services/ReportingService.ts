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
import { addDaysToDateString } from "../utils/carrierLineValidity.js";
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

  /**
   * `YYYY-MM-DD` calendar date, used to validate `from`/`to` before doing any
   * date arithmetic on them.
   */
  private static readonly DATE_STRING_RE = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * Enumerate every calendar date from `from` to `to` inclusive.
   *
   * Pure string/UTC arithmetic via {@link addDaysToDateString} — no `Date`
   * object is ever mutated with local-time setters. That distinction is the
   * whole fix: the previous implementation parsed `from`/`to` as UTC midnight
   * (`new Date("2026-03-27")`) but advanced the loop with `current.setDate()`,
   * which operates in the MACHINE'S LOCAL time zone. On a DST-observing
   * desktop (this app runs on the shop's own Beirut PC, not the Fly backend —
   * the reverse of the usual "web is UTC and wrong" direction) "advance one
   * local calendar day" is 23 or 25 hours across a transition, not 24, so the
   * UTC instant drifted across midnight and `toISOString()` emitted the wrong
   * calendar date — duplicating one day and dropping another. Iterating
   * `YYYY-MM-DD` strings sidesteps local time entirely: there is no `Date`
   * object alive across iterations for a time zone to disagree with.
   *
   * Guards against a malformed or reversed `from`/`to` turning this into an
   * infinite loop: a range failing the `YYYY-MM-DD` shape check, or with
   * `from` after `to`, returns `[]` immediately rather than looping. (A valid,
   * non-reversed range can never loop forever — each step advances the
   * lexicographically-comparable ISO string by exactly one calendar day, so
   * `current` strictly increases toward `to`.)
   */
  private getDateRange(from: string, to: string): string[] {
    if (
      !ReportingService.DATE_STRING_RE.test(from) ||
      !ReportingService.DATE_STRING_RE.test(to) ||
      from > to
    ) {
      if (
        !ReportingService.DATE_STRING_RE.test(from) ||
        !ReportingService.DATE_STRING_RE.test(to)
      ) {
        logger.warn(
          { from, to },
          "ReportingService.getDateRange: malformed date string",
        );
      } else {
        logger.warn(
          { from, to },
          "ReportingService.getDateRange: reversed range",
        );
      }
      return [];
    }

    const dates: string[] = [];
    let current = from;
    while (current <= to) {
      dates.push(current);
      current = addDaysToDateString(current, 1);
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

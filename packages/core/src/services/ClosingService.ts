import {
  ClosingRepository,
  DynamicSystemExpectedBalances,
  DailyStatsSnapshot,
  CreateCheckpointData,
  getClosingRepository,
} from "../repositories/ClosingRepository.js";
import { closingLogger } from "../utils/logger.js";
export interface ClosingResult {
  success: boolean;
  id?: number | bigint;
  error?: string;
}

export class ClosingService {
  private repo: ClosingRepository;

  constructor(repo?: ClosingRepository) {
    this.repo = repo ?? getClosingRepository();
  }

  /**
   * Recalculate drawer_balances from the payments journal
   */
  recalculateDrawerBalances(): { success: boolean; error?: string } {
    try {
      return this.repo.recalculateDrawerBalances();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.recalculateDrawerBalances error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get system expected balances (dynamic — keyed by drawer name)
   */
  getSystemExpectedBalancesDynamic(): DynamicSystemExpectedBalances {
    try {
      return this.repo.getSystemExpectedBalancesDynamic();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.getSystemExpectedBalancesDynamic error",
      );
      return {};
    }
  }

  /**
   * Get daily stats snapshot for closing report
   */
  getDailyStatsSnapshot(): DailyStatsSnapshot {
    try {
      return this.repo.getDailyStatsSnapshot();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.getDailyStatsSnapshot error",
      );
      return {
        salesCount: 0,
        totalSalesUSD: 0,
        totalSalesLBP: 0,
        debtPaymentsUSD: 0,
        debtPaymentsLBP: 0,
        totalExpensesUSD: 0,
        totalExpensesLBP: 0,
        totalProfitUSD: 0,
      };
    }
  }

  /**
   * Get checkpoint timeline for a date
   */
  async getCheckpointTimeline(
    filters: import("../repositories/ClosingRepository.js").CheckpointFilters = {},
  ): Promise<{
    success: boolean;
    checkpoints?: import("../repositories/ClosingRepository.js").CheckpointRecord[];
    error?: string;
  }> {
    try {
      const checkpoints = this.repo.getCheckpointTimeline(filters);
      return { success: true, checkpoints };
    } catch (error) {
      closingLogger.error(
        { error, filters },
        "ClosingService.getCheckpointTimeline error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get the actual amounts from the most recent checkpoint (baseline for next checkpoint).
   * Returns Record<drawerName, Record<currencyCode, amount>>
   */
  getLastCheckpointActuals(): Record<string, Record<string, number>> {
    try {
      return this.repo.getLastCheckpointActuals();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.getLastCheckpointActuals error",
      );
      return {};
    }
  }

  /**
   * Check if there is at least one checkpoint record for today's date.
   */
  hasOpeningBalanceToday(): boolean {
    try {
      return this.repo.hasOpeningBalanceToday();
    } catch (error) {
      closingLogger.error(
        { error },
        "ClosingService.hasOpeningBalanceToday error",
      );
      return false;
    }
  }

  /**
   * Update an existing daily_closings record by id.
   */
  updateDailyClosing(data: {
    id: number;
    physical_usd?: number;
    physical_lbp?: number;
    physical_eur?: number;
    system_expected_usd?: number;
    system_expected_lbp?: number;
    variance_usd?: number;
    notes?: string;
    report_path?: string;
    user_id?: number;
  }): { success: boolean; error?: string } {
    try {
      return this.repo.updateDailyClosing(data);
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.updateDailyClosing error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Set opening balances for a closing date.
   * Creates a checkpoint record of type OPENING.
   */
  setOpeningBalances(data: {
    closingDate?: string;
    userId?: number;
    amounts?: Array<{
      drawer_name: string;
      currency_code: string;
      expected_amount: number;
      physical_amount: number;
    }>;
  }): ClosingResult {
    try {
      return this.repo.createCheckpoint({
        user_id: data.userId ?? 0,
        notes: `Opening balances for ${data.closingDate ?? new Date().toISOString().split("T")[0]}`,
        amounts: data.amounts ?? [],
      });
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.setOpeningBalances error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a daily closing record (legacy — delegates to createCheckpoint).
   */
  createDailyClosing(data: {
    closingDate?: string;
    userId?: number;
    amounts?: Array<{
      drawer_name: string;
      currency_code: string;
      expected_amount: number;
      physical_amount: number;
    }>;
    notes?: string;
  }): ClosingResult {
    try {
      return this.repo.createCheckpoint({
        user_id: data.userId ?? 0,
        notes:
          data.notes ??
          `Daily closing for ${data.closingDate ?? new Date().toISOString().split("T")[0]}`,
        amounts: data.amounts ?? [],
      });
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.createDailyClosing error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a unified checkpoint (replaces both opening and closing).
   * Records expected vs actual per drawer/currency.
   */
  createCheckpoint(data: CreateCheckpointData): ClosingResult {
    try {
      return this.repo.createCheckpoint(data);
    } catch (error) {
      closingLogger.error(
        { error, data },
        "ClosingService.createCheckpoint error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Singleton instance
let closingServiceInstance: ClosingService | null = null;

export function getClosingService(): ClosingService {
  if (!closingServiceInstance) {
    closingServiceInstance = new ClosingService();
  }
  return closingServiceInstance;
}

export function resetClosingService(): void {
  closingServiceInstance = null;
}

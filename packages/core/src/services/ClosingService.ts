import {
  ClosingRepository,
  OpeningBalanceAmount,
  ClosingAmount,
  DynamicSystemExpectedBalances,
  DailyStatsSnapshot,
  getClosingRepository,
} from "../repositories/ClosingRepository.js";
import { closingLogger } from "../utils/logger.js";
export interface ClosingResult {
  success: boolean;
  id?: number | bigint;
  error?: string;
}

export interface SetOpeningBalancesData {
  closing_date: string;
  user_id: number;
  amounts: OpeningBalanceAmount[];
}

export interface CreateClosingData {
  closing_date: string;
  user_id: number;
  variance_notes?: string;
  report_path?: string;
  system_expected_usd?: number;
  system_expected_lbp?: number;
  amounts: ClosingAmount[];
}

export interface UpdateClosingData {
  id: number;
  physical_usd?: number;
  physical_lbp?: number;
  physical_eur?: number;
  system_expected_usd?: number;
  system_expected_lbp?: number;
  variance_usd?: number;
  notes?: string;
  report_path?: string;
  user_id: number;
}

export class ClosingService {
  private repo: ClosingRepository;

  constructor(repo?: ClosingRepository) {
    this.repo = repo ?? getClosingRepository();
  }

  /**
   * Set opening balances for a date
   */
  setOpeningBalances(data: SetOpeningBalancesData): ClosingResult {
    return this.repo.setOpeningBalances(
      data.closing_date,
      data.amounts,
      data.user_id!,
    );
  }

  /**
   * Create a daily closing record
   */
  createDailyClosing(data: CreateClosingData): ClosingResult {
    return this.repo.createDailyClosing(
      data.closing_date,
      data.amounts,
      data.system_expected_usd || 0,
      data.system_expected_lbp || 0,
      data.variance_notes,
      data.report_path,
      data.user_id,
    );
  }

  /**
   * Update an existing daily closing
   */
  updateDailyClosing(data: UpdateClosingData): ClosingResult {
    const patch: any = {
      ...(data.physical_usd != null ? { physical_usd: data.physical_usd } : {}),
      ...(data.physical_lbp != null ? { physical_lbp: data.physical_lbp } : {}),
      ...(data.physical_eur != null ? { physical_eur: data.physical_eur } : {}),
      ...(data.system_expected_usd != null
        ? { system_expected_usd: data.system_expected_usd }
        : {}),
      ...(data.system_expected_lbp != null
        ? { system_expected_lbp: data.system_expected_lbp }
        : {}),
      ...(data.variance_usd != null ? { variance_usd: data.variance_usd } : {}),
      ...(data.notes != null ? { notes: data.notes } : {}),
      ...(data.report_path != null ? { report_path: data.report_path } : {}),
      ...(data.user_id != null ? { updated_by: data.user_id } : {}),
    };

    return this.repo.updateDailyClosing(data.id, patch);
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
   * Check if opening balance has been set for today
   */
  hasOpeningBalanceToday(): boolean {
    const today = new Date().toISOString().split("T")[0];
    return this.repo.hasOpeningBalanceForDate(today);
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

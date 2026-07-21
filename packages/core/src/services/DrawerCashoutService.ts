import {
  DrawerCashoutRepository,
  DrawerCashoutEntity,
  CreateDrawerCashoutData,
  getDrawerCashoutRepository,
} from "../repositories/DrawerCashoutRepository.js";
import { toErrorString } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const drawerCashoutLogger = createChildLogger({ module: "drawer-cashout" });

export interface DrawerCashoutResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class DrawerCashoutService {
  private repo: DrawerCashoutRepository;

  constructor(repo?: DrawerCashoutRepository) {
    this.repo = repo ?? getDrawerCashoutRepository();
  }

  /**
   * Pull cash OUT of the General drawer (owner takes cash) for a reason that
   * is neither a business expense nor a drawer-to-drawer transfer.
   * At least one of amount_usd/amount_lbp must be greater than zero, and a
   * non-empty `notes` reason is required. The repository's insufficient-funds
   * guard (checked BOTH currencies, before any write) surfaces its message
   * verbatim on failure so the UI can show it.
   */
  addCashout(
    data: CreateDrawerCashoutData,
    userId: number,
  ): DrawerCashoutResult {
    try {
      if ((data.amount_usd ?? 0) <= 0 && (data.amount_lbp ?? 0) <= 0) {
        return {
          success: false,
          error: "At least one amount (USD or LBP) must be greater than zero.",
        };
      }

      if (!data.notes || data.notes.trim() === "") {
        return {
          success: false,
          error: "A reason is required.",
        };
      }

      const transactionTime = data.transaction_time;

      if (transactionTime) {
        const txTime = new Date(transactionTime);
        if (isNaN(txTime.getTime())) {
          return { success: false, error: "Invalid transaction_time format" };
        }
        if (txTime > new Date()) {
          return {
            success: false,
            error: "transaction_time cannot be in the future",
          };
        }
      }

      const id = this.repo.createCashout(data, userId);

      drawerCashoutLogger.info(
        {
          id,
          amountUSD: data.amount_usd,
          amountLBP: data.amount_lbp,
          notes: data.notes,
          userId,
        },
        "Drawer cash-out recorded",
      );

      return { success: true, id };
    } catch (error) {
      drawerCashoutLogger.error(
        { error, data },
        "DrawerCashoutService.addCashout error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Get recent drawer cash-out history.
   */
  getHistory(limit?: number): DrawerCashoutEntity[] {
    try {
      return this.repo.getHistory(limit);
    } catch (error) {
      drawerCashoutLogger.error(
        { error },
        "DrawerCashoutService.getHistory error",
      );
      return [];
    }
  }
}

// Singleton instance
let drawerCashoutServiceInstance: DrawerCashoutService | null = null;

export function getDrawerCashoutService(): DrawerCashoutService {
  if (!drawerCashoutServiceInstance) {
    drawerCashoutServiceInstance = new DrawerCashoutService();
  }
  return drawerCashoutServiceInstance;
}

export function resetDrawerCashoutService(): void {
  drawerCashoutServiceInstance = null;
}

import {
  DrawerTopUpRepository,
  DrawerTopUpEntity,
  CreateDrawerTopUpData,
  CreateDrawerTopUpFromDrawerData,
  SourceDrawerBalance,
  getDrawerTopUpRepository,
} from "../repositories/DrawerTopUpRepository.js";
import { toErrorString } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const drawerTopUpLogger = createChildLogger({ module: "drawer-topup" });

export interface DrawerTopUpResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class DrawerTopUpService {
  private repo: DrawerTopUpRepository;

  constructor(repo?: DrawerTopUpRepository) {
    this.repo = repo ?? getDrawerTopUpRepository();
  }

  /**
   * Add cash to the General drawer (owner brings cash).
   * At least one of amount_usd or amount_lbp must be greater than zero.
   */
  addTopUp(data: CreateDrawerTopUpData, userId: number): DrawerTopUpResult {
    try {
      if ((data.amount_usd ?? 0) <= 0 && (data.amount_lbp ?? 0) <= 0) {
        return {
          success: false,
          error: "At least one amount (USD or LBP) must be greater than zero.",
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

      const id = this.repo.createTopUp(data, userId);

      drawerTopUpLogger.info(
        {
          id,
          amountUSD: data.amount_usd,
          amountLBP: data.amount_lbp,
          notes: data.notes,
          userId,
        },
        "Drawer top-up recorded",
      );

      return { success: true, id };
    } catch (error) {
      drawerTopUpLogger.error(
        { error, data },
        "DrawerTopUpService.addTopUp error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Transfer funds from a source drawer (OMT_System) to General drawer.
   */
  topUpFromDrawer(
    data: CreateDrawerTopUpFromDrawerData,
    userId: number,
  ): DrawerTopUpResult {
    try {
      if ((data.amount_usd ?? 0) <= 0 && (data.amount_lbp ?? 0) <= 0) {
        return {
          success: false,
          error: "At least one amount (USD or LBP) must be greater than zero.",
        };
      }

      if (data.transaction_time) {
        const txTime = new Date(data.transaction_time);
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

      const id = this.repo.createTopUpFromDrawer(data, userId);

      drawerTopUpLogger.info(
        {
          id,
          amountUSD: data.amount_usd,
          amountLBP: data.amount_lbp,
          sourceDrawer: data.source_drawer,
          notes: data.notes,
          userId,
        },
        "Drawer top-up from drawer recorded",
      );

      return { success: true, id };
    } catch (error) {
      drawerTopUpLogger.error(
        { error, data },
        "DrawerTopUpService.topUpFromDrawer error",
      );
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Get available source drawers (OMT_System) with their balances.
   */
  getSourceDrawers(): SourceDrawerBalance[] {
    try {
      return this.repo.getSourceDrawerBalances();
    } catch (error) {
      drawerTopUpLogger.error(
        { error },
        "DrawerTopUpService.getSourceDrawers error",
      );
      return [];
    }
  }

  /**
   * Get recent drawer top-up history.
   */
  getHistory(limit?: number): DrawerTopUpEntity[] {
    try {
      return this.repo.getHistory(limit);
    } catch (error) {
      drawerTopUpLogger.error({ error }, "DrawerTopUpService.getHistory error");
      return [];
    }
  }
}

// Singleton instance
let drawerTopUpServiceInstance: DrawerTopUpService | null = null;

export function getDrawerTopUpService(): DrawerTopUpService {
  if (!drawerTopUpServiceInstance) {
    drawerTopUpServiceInstance = new DrawerTopUpService();
  }
  return drawerTopUpServiceInstance;
}

export function resetDrawerTopUpService(): void {
  drawerTopUpServiceInstance = null;
}

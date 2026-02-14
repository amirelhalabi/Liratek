/**
 * Recharge Service
 *
 * Business logic layer for mobile recharge operations (MTC/Alfa).
 */

import {
  RechargeRepository,
  getRechargeRepository,
  type VirtualStock,
  type RechargeData,
} from "../repositories/index.js";
import { rechargeLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface RechargeResult {
  success: boolean;
  saleId?: number;
  error?: string;
}

// =============================================================================
// Recharge Service Class
// =============================================================================

export class RechargeService {
  private rechargeRepo: RechargeRepository;

  constructor(rechargeRepo?: RechargeRepository) {
    this.rechargeRepo = rechargeRepo ?? getRechargeRepository();
  }

  /**
   * Get virtual stock for MTC and Alfa
   */
  getStock(): VirtualStock {
    try {
      return this.rechargeRepo.getVirtualStock();
    } catch (error) {
      rechargeLogger.error({ error }, "Failed to get recharge stock");
      return { mtc: 0, alfa: 0 };
    }
  }

  /**
   * Process a recharge transaction
   */
  processRecharge(data: RechargeData): RechargeResult {
    return this.rechargeRepo.processRecharge(data);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rechargeServiceInstance: RechargeService | null = null;

export function getRechargeService(): RechargeService {
  if (!rechargeServiceInstance) {
    rechargeServiceInstance = new RechargeService();
  }
  return rechargeServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetRechargeService(): void {
  rechargeServiceInstance = null;
}

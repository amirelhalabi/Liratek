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
  type RechargeEntity,
} from "../repositories/index.js";
import { rechargeLogger } from "../utils/logger.js";
import type { TopUpProvider } from "../constants/index.js";

// =============================================================================
// Types
// =============================================================================

export interface RechargeResult {
  success: boolean;
  id?: number;
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
   * Get recharge history for a provider
   */
  getHistory(provider: "MTC" | "Alfa"): RechargeEntity[] {
    try {
      return this.rechargeRepo.getHistory(provider);
    } catch (error) {
      rechargeLogger.error({ error }, "Failed to get recharge history");
      return [];
    }
  }

  /**
   * Process a recharge transaction
   */
  processRecharge(data: RechargeData): RechargeResult {
    return this.rechargeRepo.processRecharge(data);
  }

  /**
   * Top up the MTC or Alfa drawer balance
   */
  topUp(data: {
    provider: "MTC" | "Alfa";
    amount: number;
    currency?: string;
  }): { success: boolean; error?: string } {
    return this.rechargeRepo.topUp(data);
  }

  /**
   * Top up provider drawer from another drawer
   */
  topUpApp(data: {
    provider: TopUpProvider;
    amount: number;
    currency: string;
    sourceDrawer: string;
  }): { success: boolean; error?: string } {
    return this.rechargeRepo.topUpApp(data);
  }

  /**
   * Get all drawer balances
   */
  getDrawerBalances(): Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
  }> {
    return this.rechargeRepo.getDrawerBalances();
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

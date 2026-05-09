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
    userId: number;
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
    userId: number;
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

  /**
   * Update non-financial metadata on a recharge.
   * Records old/new values for audit trail.
   */
  updateRechargeMetadata(
    id: number,
    data: { phone_number?: string; client_name?: string; note?: string },
    editedBy: string,
  ): {
    success: boolean;
    entity?: RechargeEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.rechargeRepo.findById(id);
    if (!existing) {
      return { success: false, error: "Recharge not found" };
    }

    // Capture old values for audit
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    if (
      data.phone_number !== undefined &&
      data.phone_number !== existing.phone_number
    ) {
      oldValues.phone_number = existing.phone_number;
      newValues.phone_number = data.phone_number;
    }
    if (
      data.client_name !== undefined &&
      data.client_name !== existing.client_name
    ) {
      oldValues.client_name = existing.client_name;
      newValues.client_name = data.client_name;
    }
    if (data.note !== undefined && data.note !== existing.note) {
      oldValues.note = existing.note;
      newValues.note = data.note;
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing }; // No actual changes
    }

    const updated = this.rechargeRepo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    rechargeLogger.info(
      { id, editedBy, oldValues, newValues },
      "Recharge metadata updated",
    );

    return { success: true, entity: updated, oldValues };
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

/**
 * Item Cost Service
 *
 * Business logic for saved item costs.
 */

import {
  ItemCostRepository,
  getItemCostRepository,
  type ItemCostEntity,
} from "../repositories/ItemCostRepository.js";
import { financialLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ItemCostResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Item Cost Service Class
// =============================================================================

export class ItemCostService {
  private repo: ItemCostRepository;

  constructor(repo?: ItemCostRepository) {
    this.repo = repo ?? getItemCostRepository();
  }

  getAllCosts(): ItemCostEntity[] {
    try {
      return this.repo.getAllCosts();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get item costs");
      return [];
    }
  }

  getCost(
    provider: string,
    category: string,
    itemKey: string,
    currency?: string,
  ): number | null {
    try {
      return this.repo.getCost(provider, category, itemKey, currency);
    } catch (error) {
      financialLogger.error({ error }, "Failed to get item cost");
      return null;
    }
  }

  setCost(
    provider: string,
    category: string,
    itemKey: string,
    cost: number,
    currency?: string,
  ): ItemCostResult {
    try {
      this.repo.setCost(provider, category, itemKey, cost, currency);
      financialLogger.info(
        { provider, category, itemKey, cost, currency },
        "Item cost saved",
      );
      return { success: true };
    } catch (error) {
      financialLogger.error({ error }, "Failed to set item cost");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Auto-save cost after a successful transaction (silent UPSERT)
   */
  autoSaveCost(
    provider: string,
    category: string,
    itemKey: string,
    cost: number,
    currency = "USD",
  ): void {
    if (!itemKey || cost <= 0) return;
    try {
      this.repo.setCost(provider, category, itemKey, cost, currency);
    } catch {
      // Auto-save is non-critical; don't throw
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let itemCostServiceInstance: ItemCostService | null = null;

export function getItemCostService(): ItemCostService {
  if (!itemCostServiceInstance) {
    itemCostServiceInstance = new ItemCostService();
  }
  return itemCostServiceInstance;
}

export function resetItemCostService(): void {
  itemCostServiceInstance = null;
}

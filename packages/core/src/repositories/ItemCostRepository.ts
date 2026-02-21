/**
 * Item Cost Repository
 *
 * Stores saved default costs for frequently-sold mobileServices.json items.
 * Costs are auto-saved after successful transactions and auto-fill on repeat sales.
 */

import { BaseRepository } from "./BaseRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface ItemCostEntity {
  id: number;
  provider: string;
  category: string;
  item_key: string;
  cost: number;
  currency: string;
  updated_at: string;
}

// =============================================================================
// Item Cost Repository Class
// =============================================================================

export class ItemCostRepository extends BaseRepository<ItemCostEntity> {
  constructor() {
    super("item_costs", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, provider, category, item_key, cost, currency, updated_at";
  }

  /**
   * Get the saved cost for a specific item
   */
  getCost(
    provider: string,
    category: string,
    itemKey: string,
    currency = "USD",
  ): number | null {
    const row = this.db
      .prepare(
        `SELECT cost FROM item_costs
         WHERE provider = ? AND category = ? AND item_key = ? AND currency = ?`,
      )
      .get(provider, category, itemKey, currency) as
      | { cost: number }
      | undefined;
    return row?.cost ?? null;
  }

  /**
   * Get all saved costs (for frontend cache)
   */
  getAllCosts(): ItemCostEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM item_costs ORDER BY provider, category, item_key`,
      )
      .all() as ItemCostEntity[];
  }

  /**
   * UPSERT a cost for an item
   */
  setCost(
    provider: string,
    category: string,
    itemKey: string,
    cost: number,
    currency = "USD",
  ): void {
    this.db
      .prepare(
        `INSERT INTO item_costs (provider, category, item_key, cost, currency)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider, category, item_key, currency) DO UPDATE SET
           cost = excluded.cost,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(provider, category, itemKey, cost, currency);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let itemCostRepositoryInstance: ItemCostRepository | null = null;

export function getItemCostRepository(): ItemCostRepository {
  if (!itemCostRepositoryInstance) {
    itemCostRepositoryInstance = new ItemCostRepository();
  }
  return itemCostRepositoryInstance;
}

export function resetItemCostRepository(): void {
  itemCostRepositoryInstance = null;
}

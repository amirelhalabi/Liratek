/**
 * Mobile Service Item Repository
 *
 * Stores the dynamic mobile services catalog (replaces hardcoded mobileServices.ts).
 * Each row represents a single purchasable item with provider/category/subcategory
 * hierarchy and LBP cost/sell prices.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface MobileServiceItemEntity {
  id: number;
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateMobileServiceItemData {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order?: number;
  is_active?: number;
}

export interface UpdateMobileServiceItemData {
  label?: string;
  cost_lbp?: number;
  sell_lbp?: number;
  sort_order?: number;
  is_active?: number;
}

// =============================================================================
// Mobile Service Item Repository Class
// =============================================================================

export class MobileServiceItemRepository extends BaseRepository<MobileServiceItemEntity> {
  constructor() {
    super("mobile_service_items", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, created_at, updated_at";
  }

  /**
   * Get all active items ordered by provider, category, subcategory, sort_order
   */
  getAll(): MobileServiceItemEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM mobile_service_items
         WHERE is_active = 1 AND tenant_id = ?
         ORDER BY provider, category, subcategory, sort_order, label`,
      )
      .all(getCurrentTenantId()) as MobileServiceItemEntity[];
  }

  /**
   * Get ALL items including inactive (for admin CRUD page)
   */
  getAllIncludingInactive(): MobileServiceItemEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM mobile_service_items
         WHERE tenant_id = ?
         ORDER BY provider, category, subcategory, sort_order, label`,
      )
      .all(getCurrentTenantId()) as MobileServiceItemEntity[];
  }

  /**
   * Get items for a specific provider
   */
  getByProvider(provider: string): MobileServiceItemEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM mobile_service_items
         WHERE provider = ? AND is_active = 1 AND tenant_id = ?
         ORDER BY category, subcategory, sort_order, label`,
      )
      .all(provider, getCurrentTenantId()) as MobileServiceItemEntity[];
  }

  /**
   * Get items for a specific provider + category
   */
  getByProviderAndCategory(
    provider: string,
    category: string,
  ): MobileServiceItemEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM mobile_service_items
         WHERE provider = ? AND category = ? AND is_active = 1 AND tenant_id = ?
         ORDER BY subcategory, sort_order, label`,
      )
      .all(provider, category, getCurrentTenantId()) as MobileServiceItemEntity[];
  }

  /**
   * Get distinct categories for a provider
   */
  getCategories(provider: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT category FROM mobile_service_items
         WHERE provider = ? AND is_active = 1 AND tenant_id = ?
         ORDER BY category`,
      )
      .all(provider, getCurrentTenantId()) as { category: string }[];
    return rows.map((r) => r.category);
  }

  /**
   * Get distinct subcategories for a provider + category
   */
  getSubcategories(provider: string, category: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT subcategory FROM mobile_service_items
         WHERE provider = ? AND category = ? AND is_active = 1 AND tenant_id = ?
         ORDER BY subcategory`,
      )
      .all(provider, category, getCurrentTenantId()) as { subcategory: string }[];
    return rows.map((r) => r.subcategory);
  }

  /**
   * Create a new item
   */
  createItem(data: CreateMobileServiceItemData): MobileServiceItemEntity {
    const stmt = this.db.prepare(
      `INSERT INTO mobile_service_items
       (provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    const result = stmt.run(
      data.provider,
      data.category,
      data.subcategory,
      data.label,
      data.cost_lbp,
      data.sell_lbp,
      data.sort_order ?? 0,
      data.is_active ?? 1,
      getCurrentTenantId(),
    );
    return this.getById(result.lastInsertRowid as number)!;
  }

  /**
   * Update an existing item
   */
  updateItem(
    id: number,
    data: UpdateMobileServiceItemData,
  ): MobileServiceItemEntity | null {
    const sets: string[] = [];
    const values: (string | number)[] = [];

    if (data.label !== undefined) {
      sets.push("label = ?");
      values.push(data.label);
    }
    if (data.cost_lbp !== undefined) {
      sets.push("cost_lbp = ?");
      values.push(data.cost_lbp);
    }
    if (data.sell_lbp !== undefined) {
      sets.push("sell_lbp = ?");
      values.push(data.sell_lbp);
    }
    if (data.sort_order !== undefined) {
      sets.push("sort_order = ?");
      values.push(data.sort_order);
    }
    if (data.is_active !== undefined) {
      sets.push("is_active = ?");
      values.push(data.is_active);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE mobile_service_items SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.getById(id);
  }

  /**
   * Toggle active status
   */
  toggleActive(id: number): MobileServiceItemEntity | null {
    this.db
      .prepare(
        `UPDATE mobile_service_items
         SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(id, getCurrentTenantId());
    return this.getById(id);
  }

  /**
   * Hard delete an item
   */
  deleteItem(id: number): void {
    this.db
      .prepare(`DELETE FROM mobile_service_items WHERE id = ? AND tenant_id = ?`)
      .run(id, getCurrentTenantId());
  }

  /**
   * Bulk insert items (uses INSERT OR IGNORE to skip duplicates)
   * Returns count of inserted rows
   */
  bulkCreate(items: CreateMobileServiceItemData[]): number {
    const tenantId = getCurrentTenantId();
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO mobile_service_items
       (provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );

    let inserted = 0;
    const runBulk = this.db.transaction(
      (rows: CreateMobileServiceItemData[]) => {
        for (const item of rows) {
          const result = stmt.run(
            item.provider,
            item.category,
            item.subcategory,
            item.label,
            item.cost_lbp,
            item.sell_lbp,
            item.sort_order ?? 0,
            item.is_active ?? 1,
            tenantId,
          );
          if (result.changes > 0) inserted++;
        }
      },
    );

    runBulk(items);
    return inserted;
  }

  /**
   * Get total count of items (used to check if seeding is needed)
   */
  getCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM mobile_service_items WHERE tenant_id = ?`)
      .get(getCurrentTenantId()) as { cnt: number };
    return row.cnt;
  }

  /**
   * Get a single item by id
   */
  getById(id: number): MobileServiceItemEntity | null {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM mobile_service_items WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, getCurrentTenantId()) as MobileServiceItemEntity | null;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: MobileServiceItemRepository | null = null;

export function getMobileServiceItemRepository(): MobileServiceItemRepository {
  if (!instance) {
    instance = new MobileServiceItemRepository();
  }
  return instance;
}

export function resetMobileServiceItemRepository(): void {
  instance = null;
}

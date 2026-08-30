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
  /** Structured validity (days) — LIRA W6.b. Null when not applicable. */
  validity_days: number | null;
  /** Structured credit amount (USD) — LIRA W6.b. Null when not applicable. */
  credits: number | null;
  /**
   * LIRA-090 (v140): the LBP cost attributable to validity days alone,
   * subtracted from `cost_lbp` to derive the credit's cost (spec §2.3).
   * Null until an admin configures the Only-Days split — see
   * `isTelecomSplitComplete` (utils/telecomCredit.ts), the single shared
   * gate predicate (rule 14). Items without this keep today's manual
   * `returnedCreditsUsd` behaviour (plan §3 decision 5).
   */
  days_cost_lbp: number | null;
  /**
   * LIRA-090 (v140): the customer price when only the days are sold — the
   * Only-Days sale-time default, operator-overridable (plan §5.1).
   */
  sell_days_lbp: number | null;
  /**
   * LIRA-090 (v140): decision-aid display price for resold recovered
   * credit, feeding the §2.4 three-row table. NOT part of
   * `isTelecomSplitComplete` — it is a pricing display field, not a split
   * completeness input.
   */
  sell_credit_lbp: number | null;
  /**
   * v160: per-card override of the returnable credit maximum. NULL means "use
   * the computed `maxReturnableCredits(credits)`", which is every card's
   * default. Read through `resolveMaxReturnedCredits` — never `?? computed`
   * at a call site (rule 14).
   */
  max_returned_credits_usd: number | null;
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
  validity_days?: number | null;
  credits?: number | null;
  /** LIRA-090 (v140) — see `MobileServiceItemEntity.days_cost_lbp`. */
  days_cost_lbp?: number | null;
  /** LIRA-090 (v140) — see `MobileServiceItemEntity.sell_days_lbp`. */
  sell_days_lbp?: number | null;
  /** LIRA-090 (v140) — see `MobileServiceItemEntity.sell_credit_lbp`. */
  sell_credit_lbp?: number | null;
  /** v160 — see `MobileServiceItemEntity.max_returned_credits_usd`. */
  max_returned_credits_usd?: number | null;
}

export interface UpdateMobileServiceItemData {
  label?: string;
  cost_lbp?: number;
  sell_lbp?: number;
  sort_order?: number;
  is_active?: number;
  validity_days?: number | null;
  credits?: number | null;
  /** LIRA-090 (v140) — see `MobileServiceItemEntity.days_cost_lbp`. */
  days_cost_lbp?: number | null;
  /** LIRA-090 (v140) — see `MobileServiceItemEntity.sell_days_lbp`. */
  sell_days_lbp?: number | null;
  /** LIRA-090 (v140) — see `MobileServiceItemEntity.sell_credit_lbp`. */
  sell_credit_lbp?: number | null;
  /** v160 — see `MobileServiceItemEntity.max_returned_credits_usd`. */
  max_returned_credits_usd?: number | null;
}

// =============================================================================
// Mobile Service Item Repository Class
// =============================================================================

export class MobileServiceItemRepository extends BaseRepository<MobileServiceItemEntity> {
  constructor() {
    super("mobile_service_items", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, validity_days, credits, days_cost_lbp, sell_days_lbp, sell_credit_lbp, max_returned_credits_usd, created_at, updated_at";
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
      .all(
        provider,
        category,
        getCurrentTenantId(),
      ) as MobileServiceItemEntity[];
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
      .all(provider, category, getCurrentTenantId()) as {
      subcategory: string;
    }[];
    return rows.map((r) => r.subcategory);
  }

  /**
   * Create a new item
   */
  createItem(data: CreateMobileServiceItemData): MobileServiceItemEntity {
    const stmt = this.db.prepare(
      `INSERT INTO mobile_service_items
       (provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, validity_days, credits, days_cost_lbp, sell_days_lbp, sell_credit_lbp, max_returned_credits_usd, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
      data.validity_days ?? null,
      data.credits ?? null,
      data.days_cost_lbp ?? null,
      data.sell_days_lbp ?? null,
      data.sell_credit_lbp ?? null,
      data.max_returned_credits_usd ?? null,
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
    const values: (string | number | null)[] = [];

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
    if (data.validity_days !== undefined) {
      sets.push("validity_days = ?");
      values.push(data.validity_days);
    }
    if (data.credits !== undefined) {
      sets.push("credits = ?");
      values.push(data.credits);
    }
    if (data.days_cost_lbp !== undefined) {
      sets.push("days_cost_lbp = ?");
      values.push(data.days_cost_lbp);
    }
    if (data.sell_days_lbp !== undefined) {
      sets.push("sell_days_lbp = ?");
      values.push(data.sell_days_lbp);
    }
    if (data.sell_credit_lbp !== undefined) {
      sets.push("sell_credit_lbp = ?");
      values.push(data.sell_credit_lbp);
    }
    if (data.max_returned_credits_usd !== undefined) {
      sets.push("max_returned_credits_usd = ?");
      values.push(data.max_returned_credits_usd);
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
      .prepare(
        `DELETE FROM mobile_service_items WHERE id = ? AND tenant_id = ?`,
      )
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
       (provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, validity_days, credits, days_cost_lbp, sell_days_lbp, sell_credit_lbp, max_returned_credits_usd, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
            item.validity_days ?? null,
            item.credits ?? null,
            item.days_cost_lbp ?? null,
            item.sell_days_lbp ?? null,
            item.sell_credit_lbp ?? null,
            item.max_returned_credits_usd ?? null,
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
      .prepare(
        `SELECT COUNT(*) as cnt FROM mobile_service_items WHERE tenant_id = ?`,
      )
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

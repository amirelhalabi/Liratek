/**
 * Stock Adjustment Repository (LIRA-077)
 *
 * Audit trail for manual stock corrections (set-absolute or delta) made via
 * InventoryService.adjustStock / adjustStockDelta. Every adjustment row is
 * written by ProductRepository.adjustStock/adjustStockDelta in the SAME db
 * transaction as the products.stock_quantity UPDATE (this repository never
 * opens its own transaction for that — the caller's `this.transaction(...)`
 * wraps both writes so a mid-failure can never leave one without the other,
 * rule 13/20 discipline).
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Types
// =============================================================================

export interface StockAdjustmentEntity {
  id: number;
  product_id: number;
  delta: number;
  old_quantity: number;
  new_quantity: number;
  reason: string;
  user_id: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Read shape with the acting user's username resolved via LEFT JOIN — null
 * when user_id is null (unattributed / legacy) or the user row was later
 * deleted. Used by the history reads; `create()` returns the plain entity.
 */
export interface StockAdjustmentWithUser extends StockAdjustmentEntity {
  username: string | null;
}

export type CreateStockAdjustmentData = Omit<
  StockAdjustmentEntity,
  "id" | "created_at" | "updated_at"
>;

// =============================================================================
// Repository
// =============================================================================

const SELECT_WITH_USER = `
  SELECT sa.id, sa.product_id, sa.delta, sa.old_quantity, sa.new_quantity,
         sa.reason, sa.user_id, sa.created_at, sa.updated_at, u.username
  FROM stock_adjustments sa
  LEFT JOIN users u ON u.id = sa.user_id
`;

export class StockAdjustmentRepository extends BaseRepository<StockAdjustmentEntity> {
  constructor() {
    super("stock_adjustments");
  }

  protected getColumns(): string {
    return "id, product_id, delta, old_quantity, new_quantity, reason, user_id, created_at, updated_at";
  }

  /**
   * Insert an audit row. Callers MUST invoke this from inside their own
   * `this.transaction(...)` (see ProductRepository.adjustStock/
   * adjustStockDelta) so the audit row and the stock_quantity UPDATE commit
   * or roll back together.
   */
  create(data: CreateStockAdjustmentData): StockAdjustmentEntity {
    const stmt = this.db.prepare(`
      INSERT INTO stock_adjustments
        (tenant_id, product_id, delta, old_quantity, new_quantity, reason, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    const result = stmt.run(
      getCurrentTenantId(),
      data.product_id,
      data.delta,
      data.old_quantity,
      data.new_quantity,
      data.reason,
      data.user_id,
    );
    return this.findByIdOrFail(Number(result.lastInsertRowid));
  }

  /** Adjustment history for one product, most recent first. */
  getByProduct(
    productId: number,
    limit: number = 50,
  ): StockAdjustmentWithUser[] {
    const n = Math.min(Math.max(Number(limit), 1), 500);
    return this.db
      .prepare(
        `${SELECT_WITH_USER} WHERE sa.product_id = ? AND sa.tenant_id = ? ORDER BY sa.id DESC LIMIT ?`,
      )
      .all(productId, getCurrentTenantId(), n) as StockAdjustmentWithUser[];
  }

  /** Most recent adjustments across all products (admin-wide audit view). */
  getRecent(limit: number = 200): StockAdjustmentWithUser[] {
    const n = Math.min(Math.max(Number(limit), 1), 1000);
    return this.db
      .prepare(
        `${SELECT_WITH_USER} WHERE sa.tenant_id = ? ORDER BY sa.id DESC LIMIT ?`,
      )
      .all(getCurrentTenantId(), n) as StockAdjustmentWithUser[];
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: StockAdjustmentRepository | null = null;

export function getStockAdjustmentRepository(): StockAdjustmentRepository {
  if (!instance) {
    instance = new StockAdjustmentRepository();
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetStockAdjustmentRepository(): void {
  instance = null;
}

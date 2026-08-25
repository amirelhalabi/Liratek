/**
 * Product Repository
 *
 * Handles all database operations for products/inventory.
 * Extends BaseRepository for standard CRUD operations.
 */

import {
  BaseRepository,
  type FindOptions,
  type PaginatedResult,
} from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getStockAdjustmentRepository } from "./StockAdjustmentRepository.js";

// =============================================================================
// Types
// =============================================================================

export interface ProductEntity {
  id: number;
  barcode: string;
  name: string;
  category: string;
  item_type: string;
  cost_price_usd: number;
  selling_price_usd: number;
  whish_price?: number;
  stock_quantity: number;
  min_stock_level: number;
  image_url: string | null;
  imei: string | null;
  color: string | null;
  // NOTE: warranty_expiry intentionally NOT projected (LIRA-143 v157 decision
  // #4) — the column stays in the DB but is dead: no UI reads/writes it, and
  // warranty is now sourced from products.warranty_months / sale_items.warranty_until.
  status: string;
  is_active: number; // SQLite boolean (0 or 1)
  is_deleted: number;
  supplier: string | null;
  created_at: string;
  updated_at: string;
}

/** Product as returned to the frontend (with aliased price fields) */
export interface ProductDTO {
  id: number;
  barcode: string;
  name: string;
  category: string;
  cost_price: number;
  retail_price: number;
  stock_quantity: number;
  min_stock_level: number;
  image_url: string | null;
  is_active: number;
  is_deleted: number;
  supplier: string | null;
  created_at: string;
  /** LIRA-143 v157 (decision #9): inherited from the product's category
   *  (product_categories.tracks_imei_units), 0 for an uncategorized
   *  product. SQLite boolean (0 or 1). */
  tracks_imei_units: number;
  /** LIRA-143 v157 (decision #4): duration on the MODEL; NULL = no
   *  warranty. The clock starts at sale time, not here. */
  warranty_months: number | null;
}

export interface CreateProductData {
  barcode: string | null;
  name: string;
  category: string;
  category_id?: number | null;
  cost_price: number; // Maps to cost_price_usd
  retail_price: number; // Maps to selling_price_usd
  stock_quantity?: number;
  min_stock_level?: number;
  image_url?: string;
  item_type?: string;
  supplier?: string | null;
  /** LIRA-143 v157 (decision #4): NULL = no warranty. Set on the product
   *  form; NOT inherited from the category (tracks_imei_units is). */
  warranty_months?: number | null;
}

export interface UpdateProductData {
  barcode?: string;
  name?: string;
  category?: string;
  category_id?: number | null;
  cost_price?: number;
  retail_price?: number;
  min_stock_level?: number;
  image_url?: string;
  supplier?: string | null;
  stock_quantity?: number;
  /** LIRA-143 v157 (decision #4): NULL = no warranty. */
  warranty_months?: number | null;
}

export interface StockStats {
  stock_budget_usd: number;
  stock_count: number;
}

export interface LowStockProduct {
  id: number;
  name: string;
  stock_quantity: number;
  min_stock_level: number;
}

export interface NegativeStockProduct {
  id: number;
  name: string;
  barcode: string | null;
  stock_quantity: number;
}

// =============================================================================
// Repository
// =============================================================================

export class ProductRepository extends BaseRepository<ProductEntity> {
  constructor() {
    super("products", { softDelete: true });
  }

  // Override getColumns() from BaseRepository
  protected getColumns(): string {
    return "id, barcode, name, item_type, category, description, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, status, is_active, is_deleted, supplier, created_at, updated_at";
  }

  // ---------------------------------------------------------------------------
  // Product-Specific Queries
  // ---------------------------------------------------------------------------

  /**
   * Rule-14 single definition of "this product has a unit whose IMEI
   * matches" (LIRA-143 Phase 3, owner decision #2: IMEI joins product
   * search everywhere barcode works). Matches ALL unit statuses
   * deliberately (owner decision #7: the same search must still find a
   * SOLD unit's model) — do NOT add `AND pu.status = 'IN_STOCK'` here.
   * `qualifier` is the products table alias ("p") or the bare table name
   * ("products") for unaliased queries; both call sites append exactly one
   * extra `%term%`-style LIKE param for the `?` this fragment introduces.
   */
  private static unitImeiMatchFragment(qualifier: string): string {
    return `EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = ${qualifier}.id AND pu.tenant_id = ${qualifier}.tenant_id AND pu.imei LIKE ?)`;
  }

  /**
   * Get all products with optional search filter (as DTOs for frontend)
   */
  findAllProducts(search?: string): ProductDTO[] {
    try {
      const tenantId = getCurrentTenantId();
      let query = `
        SELECT
          p.id, p.barcode, p.name, p.stock_quantity, p.min_stock_level,
          p.image_url, p.is_active, p.is_deleted, p.created_at,
          p.cost_price_usd as cost_price,
          p.selling_price_usd as retail_price,
          p.supplier,
          p.category_id,
          p.warranty_months,
          COALESCE(pc.name, p.category) as category,
          COALESCE(pc.tracks_imei_units, 0) as tracks_imei_units
        FROM ${this.tableName} p
        LEFT JOIN product_categories pc ON pc.id = p.category_id AND pc.tenant_id = ?
        WHERE p.is_active = 1 AND p.is_deleted = 0
          AND p.item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND p.tenant_id = ?
      `;
      const params: (string | number)[] = [tenantId, tenantId];

      if (search) {
        query += ` AND (p.name LIKE ? OR p.barcode LIKE ? OR COALESCE(pc.name, p.category) LIKE ? OR ${ProductRepository.unitImeiMatchFragment("p")})`;
        const term = `%${search}%`;
        params.push(term, term, term, term);
      }

      query += ` ORDER BY p.name ASC`;
      return this.query<ProductDTO>(query, ...params);
    } catch (error) {
      throw new DatabaseError("Failed to find products", { cause: error });
    }
  }

  /**
   * Get paginated products with search filter
   */
  findProductsPaginated(
    options: FindOptions & { search?: string } = {},
  ): PaginatedResult<ProductDTO> {
    const { limit = 50, offset = 0, search } = options;

    const data = this.findAllProducts(search);
    const total = search ? data.length : this.count();

    // Apply pagination in memory for simplicity (or could do SQL LIMIT/OFFSET)
    const paginatedData = limit ? data.slice(offset, offset + limit) : data;

    return {
      data: paginatedData,
      total,
      limit,
      offset,
      hasMore: offset + paginatedData.length < total,
    };
  }

  /**
   * Get product by barcode
   */
  findByBarcode(barcode: string): ProductEntity | null {
    try {
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE barcode = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`;
      return this.queryOne<ProductEntity>(query, barcode, getCurrentTenantId());
    } catch (error) {
      throw new DatabaseError("Failed to find product by barcode", {
        cause: error,
      });
    }
  }

  /**
   * Check if a barcode exists among active products.
   * Soft-deleted products are excluded so that re-importing a barcode
   * falls through to createProduct(), which reactivates the deleted row.
   */
  barcodeExists(barcode: string, excludeId?: number): boolean {
    try {
      const tenantId = getCurrentTenantId();
      const query = excludeId
        ? `SELECT 1 FROM ${this.tableName} WHERE barcode = ? AND id != ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`
        : `SELECT 1 FROM ${this.tableName} WHERE barcode = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`;

      const params = excludeId
        ? [barcode, excludeId, tenantId]
        : [barcode, tenantId];
      return this.queryOne<{ 1: number }>(query, ...params) !== null;
    } catch (error) {
      throw new DatabaseError("Failed to check barcode existence", {
        cause: error,
      });
    }
  }

  /**
   * Create a new product
   */
  createProduct(data: CreateProductData): { id: number } {
    const tenantId = getCurrentTenantId();
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (
          barcode, name, category, category_id, cost_price_usd, selling_price_usd,
          stock_quantity, min_stock_level, image_url, item_type, supplier, warranty_months, created_at, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `);

      const result = stmt.run(
        data.barcode,
        data.name,
        data.category,
        data.category_id ?? null,
        data.cost_price,
        data.retail_price,
        data.stock_quantity ?? 0,
        data.min_stock_level ?? 5,
        data.image_url ?? null,
        data.item_type ?? "Product",
        data.supplier ?? null,
        data.warranty_months ?? null,
        tenantId,
      );

      return { id: result.lastInsertRowid as number };
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE" && data.barcode) {
        // Check if the collision is with a soft-deleted product — reactivate it
        // Check both is_active=0 OR is_deleted=1
        const deleted = this.queryOne<ProductEntity>(
          `SELECT id FROM ${this.tableName} WHERE barcode = ? AND (is_active = 0 OR is_deleted = 1) AND tenant_id = ?`,
          data.barcode,
          tenantId,
        );
        if (deleted) {
          this.db
            .prepare(
              `UPDATE ${this.tableName} SET
                name = ?, category = COALESCE(?, category), category_id = COALESCE(?, category_id),
                cost_price_usd = ?, selling_price_usd = ?,
                stock_quantity = ?, min_stock_level = ?,
                image_url = COALESCE(?, image_url), item_type = COALESCE(?, item_type),
                supplier = COALESCE(?, supplier), warranty_months = ?,
                is_active = 1, is_deleted = 0,
                created_at = COALESCE(created_at, datetime('now')),
                updated_at = datetime('now')
              WHERE id = ? AND tenant_id = ?`,
            )
            .run(
              data.name,
              data.category,
              data.category_id ?? null,
              data.cost_price,
              data.retail_price,
              data.stock_quantity ?? 0,
              data.min_stock_level ?? 5,
              data.image_url ?? null,
              data.item_type ?? "Product",
              data.supplier ?? null,
              data.warranty_months ?? null,
              deleted.id,
              tenantId,
            );
          return { id: deleted.id };
        }
        throw new DatabaseError("Barcode already exists", {
          cause: error,
          code: "DUPLICATE_BARCODE",
        });
      }
      throw new DatabaseError("Failed to create product", { cause: error });
    }
  }

  /**
   * Update an existing product
   */
  updateProduct(id: number, data: UpdateProductData): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET
          barcode = COALESCE(?, barcode),
          name = COALESCE(?, name),
          category = COALESCE(?, category),
          cost_price_usd = COALESCE(?, cost_price_usd),
          selling_price_usd = COALESCE(?, selling_price_usd),
          min_stock_level = COALESCE(?, min_stock_level),
          image_url = COALESCE(?, image_url),
          warranty_months = COALESCE(?, warranty_months),
          updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
      `);

      const result = stmt.run(
        data.barcode ?? null,
        data.name ?? null,
        data.category ?? null,
        data.cost_price ?? null,
        data.retail_price ?? null,
        data.min_stock_level ?? null,
        data.image_url ?? null,
        data.warranty_months ?? null,
        id,
        getCurrentTenantId(),
      );

      return result.changes > 0;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DatabaseError("Barcode already exists", {
          cause: error,
          code: "DUPLICATE_BARCODE",
        });
      }
      throw new DatabaseError("Failed to update product", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Update product with all fields explicitly (for handler compatibility)
   */
  /**
   * Batch-update shared fields for multiple products.
   * Only updates fields that are explicitly provided (non-undefined).
   * Unique fields (barcode, name, cost, retail price) are intentionally excluded.
   */
  batchUpdateProducts(
    ids: number[],
    data: {
      category?: string;
      category_id?: number | null;
      min_stock_level?: number;
      supplier?: string | null;
    },
  ): number {
    if (ids.length === 0) return 0;

    // Build SET clause dynamically from provided fields
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (data.category !== undefined) {
      setClauses.push("category = ?");
      params.push(data.category);
    }
    if (data.category_id !== undefined) {
      setClauses.push("category_id = ?");
      params.push(data.category_id);
    }
    if (data.min_stock_level !== undefined) {
      setClauses.push("min_stock_level = ?");
      params.push(data.min_stock_level);
    }
    if (data.supplier !== undefined) {
      setClauses.push("supplier = ?");
      params.push(data.supplier);
    }

    if (setClauses.length === 0) return 0;

    setClauses.push("updated_at = datetime('now')");

    const placeholders = ids.map(() => "?").join(", ");
    params.push(...ids);
    params.push(getCurrentTenantId());

    const result = this.db
      .prepare(
        `UPDATE ${this.tableName} SET ${setClauses.join(", ")} WHERE id IN (${placeholders}) AND tenant_id = ?`,
      )
      .run(...(params as Parameters<typeof this.db.prepare>[0][]));

    return result.changes;
  }

  /**
   * Soft-delete multiple products in a single SQL statement.
   * Returns the number of rows affected.
   */
  batchSoftDelete(ids: number[]): number {
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => "?").join(", ");
    const tenantId = getCurrentTenantId();
    const result = this.db
      .prepare(
        `UPDATE ${this.tableName} SET is_deleted = 1, updated_at = datetime('now') WHERE id IN (${placeholders}) AND tenant_id = ?`,
      )
      .run(...([...ids, tenantId] as any[]));

    return result.changes;
  }

  updateProductFull(
    id: number,
    data: {
      barcode: string;
      name: string;
      category: string;
      category_id?: number | null;
      cost_price: number;
      retail_price: number;
      min_stock_level: number;
      image_url?: string | null;
      supplier?: string | null;
      stock_quantity?: number;
      /** LIRA-143 v157 (decision #4): NULL = no warranty. */
      warranty_months?: number | null;
    },
  ): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET
          barcode = ?, name = ?, category = ?, category_id = ?, cost_price_usd = ?,
          selling_price_usd = ?, min_stock_level = ?, image_url = ?,
          supplier = ?, stock_quantity = COALESCE(?, stock_quantity),
          warranty_months = ?,
          updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
      `);

      const result = stmt.run(
        data.barcode,
        data.name,
        data.category,
        data.category_id ?? null,
        data.cost_price,
        data.retail_price,
        data.min_stock_level,
        data.image_url ?? null,
        data.supplier ?? null,
        data.stock_quantity ?? null,
        data.warranty_months ?? null,
        id,
        getCurrentTenantId(),
      );

      return result.changes > 0;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DatabaseError("Barcode already exists", {
          cause: error,
          code: "DUPLICATE_BARCODE",
        });
      }
      throw new DatabaseError("Failed to update product", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Adjust stock quantity (set to absolute value).
   *
   * LIRA-077: writes a `stock_adjustments` audit row (old/new quantity,
   * delta, reason, acting user) in the SAME db transaction as the
   * stock_quantity UPDATE — repo-level transaction so a mid-failure can
   * never leave the audit trail out of sync with the actual quantity
   * (rule 13/20 discipline: services never touch the DB, this is where the
   * atomicity lives).
   */
  adjustStock(
    id: number,
    newQuantity: number,
    reason: string,
    userId: number | null,
  ): boolean {
    try {
      const tenantId = getCurrentTenantId();
      return this.transaction(() => {
        const current = this.db
          .prepare(
            `SELECT stock_quantity FROM ${this.tableName} WHERE id = ? AND tenant_id = ?`,
          )
          .get(id, tenantId) as { stock_quantity: number } | undefined;
        if (!current) return false;

        const oldQuantity = current.stock_quantity;
        const result = this.execute(
          `UPDATE ${this.tableName} SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
          newQuantity,
          id,
          tenantId,
        );
        if (result.changes > 0) {
          getStockAdjustmentRepository().create({
            product_id: id,
            delta: newQuantity - oldQuantity,
            old_quantity: oldQuantity,
            new_quantity: newQuantity,
            reason,
            user_id: userId,
          });
        }
        return result.changes > 0;
      });
    } catch (error) {
      throw new DatabaseError("Failed to adjust stock", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Increment/decrement stock quantity.
   *
   * LIRA-077: same audit-in-transaction contract as {@link adjustStock}.
   */
  adjustStockDelta(
    id: number,
    delta: number,
    reason: string,
    userId: number | null,
  ): boolean {
    try {
      const tenantId = getCurrentTenantId();
      return this.transaction(() => {
        const current = this.db
          .prepare(
            `SELECT stock_quantity FROM ${this.tableName} WHERE id = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`,
          )
          .get(id, tenantId) as { stock_quantity: number } | undefined;
        if (!current) return false;

        const oldQuantity = current.stock_quantity;
        const newQuantity = oldQuantity + delta;
        const result = this.execute(
          `UPDATE ${this.tableName} SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ? AND is_active = 1 AND is_deleted = 0 AND tenant_id = ?`,
          delta,
          id,
          tenantId,
        );
        if (result.changes > 0) {
          getStockAdjustmentRepository().create({
            product_id: id,
            delta,
            old_quantity: oldQuantity,
            new_quantity: newQuantity,
            reason,
            user_id: userId,
          });
        }
        return result.changes > 0;
      });
    } catch (error) {
      throw new DatabaseError("Failed to adjust stock delta", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Deduct stock for multiple products.
   *
   * ⚠️ UNGUARDED / currently unused. This does a blind `stock_quantity - qty`
   * with no `>= qty` guard or rows-affected check, so it can oversell into
   * negative stock. Do NOT wire this into a sale-finalization path — the live
   * sale uses the guarded decrement in `SalesRepository.processSale`. If this
   * ever becomes live, port that guard here first (iterate items with a
   * conditional UPDATE + rows-affected check).
   */
  deductStockForSale(saleId: number): void {
    try {
      const tenantId = getCurrentTenantId();
      this.execute(
        `
        UPDATE ${this.tableName}
        SET stock_quantity = stock_quantity - (
          SELECT quantity
          FROM sale_items
          WHERE sale_items.product_id = products.id AND sale_items.sale_id = ? AND sale_items.tenant_id = ?
        ), updated_at = datetime('now')
        WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = ? AND tenant_id = ?) AND tenant_id = ?
      `,
        saleId,
        tenantId,
        saleId,
        tenantId,
        tenantId,
      );
    } catch (error) {
      throw new DatabaseError("Failed to deduct stock for sale", {
        cause: error,
      });
    }
  }

  /**
   * Get stock statistics (budget and count)
   */
  getStockStats(): StockStats {
    try {
      const result = this.queryOne<StockStats>(
        `
        SELECT
          COALESCE(SUM(cost_price_usd * stock_quantity), 0) AS stock_budget_usd,
          COALESCE(SUM(stock_quantity), 0) AS stock_count
        FROM ${this.tableName}
        WHERE is_active = 1 AND is_deleted = 0
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND tenant_id = ?
      `,
        getCurrentTenantId(),
      );
      return result ?? { stock_budget_usd: 0, stock_count: 0 };
    } catch (error) {
      throw new DatabaseError("Failed to get stock stats", { cause: error });
    }
  }

  /**
   * Get products that are at or below minimum stock level
   * Excludes virtual products (MTC/Alfa credits are tracked via drawer_balances)
   */
  findLowStock(): LowStockProduct[] {
    try {
      return this.query<LowStockProduct>(
        `
        SELECT id, name, stock_quantity, min_stock_level
        FROM ${this.tableName}
        WHERE stock_quantity <= min_stock_level AND is_active = 1 AND is_deleted = 0
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND tenant_id = ?
        ORDER BY name ASC
      `,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to get low stock products", {
        cause: error,
      });
    }
  }

  /**
   * Products whose stock has gone negative — oversold before the stock-oversell
   * guard shipped, or via a manual adjustment. They can no longer be sold (the
   * guard blocks stock < qty) until the count is reconciled. Excludes virtual
   * (MTC/Alfa) items, which are not physical stock. Tenant-scoped.
   */
  findNegativeStock(): NegativeStockProduct[] {
    try {
      return this.query<NegativeStockProduct>(
        `
        SELECT id, name, barcode, stock_quantity
        FROM ${this.tableName}
        WHERE stock_quantity < 0 AND is_deleted = 0
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
          AND tenant_id = ?
        ORDER BY stock_quantity ASC
      `,
        getCurrentTenantId(),
      );
    } catch (error) {
      throw new DatabaseError("Failed to get negative-stock products", {
        cause: error,
      });
    }
  }

  /**
   * Search products by multiple criteria
   */
  search(
    term: string,
    options: { limit?: number; category?: string } = {},
  ): ProductDTO[] {
    try {
      const { limit = 20, category } = options;
      const searchTerm = `%${term}%`;
      const tenantId = getCurrentTenantId();

      let query = `
        SELECT
          id, barcode, name, category, stock_quantity, min_stock_level,
          image_url, is_active, is_deleted, created_at,
          cost_price_usd as cost_price,
          selling_price_usd as retail_price
        FROM ${this.tableName}
        WHERE is_active = 1 AND is_deleted = 0 AND (name LIKE ? OR barcode LIKE ? OR ${ProductRepository.unitImeiMatchFragment("products")}) AND tenant_id = ?
      `;
      const params: (string | number)[] = [
        searchTerm,
        searchTerm,
        searchTerm,
        tenantId,
      ];

      if (category) {
        query += ` AND category = ?`;
        params.push(category);
      }

      query += ` ORDER BY name ASC LIMIT ?`;
      params.push(limit);

      return this.query<ProductDTO>(query, ...params);
    } catch (error) {
      throw new DatabaseError("Failed to search products", { cause: error });
    }
  }

  /**
   * Get all distinct categories
   */
  getCategories(): string[] {
    try {
      const results = this.query<{ category: string }>(
        `
        SELECT DISTINCT category FROM ${this.tableName}
        WHERE is_active = 1 AND is_deleted = 0 AND category IS NOT NULL AND category != ''
          AND tenant_id = ?
        ORDER BY category ASC
      `,
        getCurrentTenantId(),
      );
      return results.map((r) => r.category);
    } catch (error) {
      throw new DatabaseError("Failed to get categories", { cause: error });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let productRepositoryInstance: ProductRepository | null = null;

export function getProductRepository(): ProductRepository {
  if (!productRepositoryInstance) {
    productRepositoryInstance = new ProductRepository();
  }
  return productRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetProductRepository(): void {
  productRepositoryInstance = null;
}

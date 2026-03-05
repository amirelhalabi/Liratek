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
  warranty_expiry: string | null;
  status: string;
  is_active: number; // SQLite boolean (0 or 1)
  supplier: string | null;
  created_at: string;
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
  supplier: string | null;
  created_at: string;
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

// =============================================================================
// Repository
// =============================================================================

export class ProductRepository extends BaseRepository<ProductEntity> {
  constructor() {
    super("products", { softDelete: true });
  }

  // Override getColumns() from BaseRepository
  protected getColumns(): string {
    return "id, barcode, name, item_type, category, description, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, warranty_expiry, status, is_active, supplier, created_at, is_deleted, updated_at";
  }

  // ---------------------------------------------------------------------------
  // Product-Specific Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all products with optional search filter (as DTOs for frontend)
   */
  findAllProducts(search?: string): ProductDTO[] {
    try {
      let query = `
        SELECT 
          p.id, p.barcode, p.name, p.stock_quantity, p.min_stock_level, 
          p.image_url, p.is_active, p.created_at,
          p.cost_price_usd as cost_price, 
          p.selling_price_usd as retail_price,
          p.supplier,
          p.category_id,
          COALESCE(pc.name, p.category) as category
        FROM ${this.tableName} p
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE p.is_active = 1
          AND p.item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
      `;
      const params: (string | number)[] = [];

      if (search) {
        query += ` AND (p.name LIKE ? OR p.barcode LIKE ? OR COALESCE(pc.name, p.category) LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term);
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
      const query = `SELECT ${this.getColumns()} FROM ${this.tableName} WHERE barcode = ? AND is_active = 1`;
      return this.queryOne<ProductEntity>(query, barcode);
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
      const query = excludeId
        ? `SELECT 1 FROM ${this.tableName} WHERE barcode = ? AND id != ? AND is_active = 1`
        : `SELECT 1 FROM ${this.tableName} WHERE barcode = ? AND is_active = 1`;

      const params = excludeId ? [barcode, excludeId] : [barcode];
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
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (
          barcode, name, category, category_id, cost_price_usd, selling_price_usd, 
          stock_quantity, min_stock_level, image_url, item_type, supplier, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      );

      return { id: result.lastInsertRowid as number };
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE" && data.barcode) {
        // Check if the collision is with a soft-deleted product — reactivate it
        const deleted = this.queryOne<ProductEntity>(
          `SELECT id FROM ${this.tableName} WHERE barcode = ? AND is_active = 0`,
          data.barcode,
        );
        if (deleted) {
          this.db
            .prepare(
              `UPDATE ${this.tableName} SET
                name = ?, category = COALESCE(?, category), category_id = COALESCE(?, category_id),
                cost_price_usd = ?, selling_price_usd = ?,
                stock_quantity = ?, min_stock_level = ?,
                image_url = COALESCE(?, image_url), item_type = COALESCE(?, item_type),
                supplier = COALESCE(?, supplier), is_active = 1
              WHERE id = ?`,
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
              deleted.id,
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
          image_url = COALESCE(?, image_url)
        WHERE id = ?
      `);

      const result = stmt.run(
        data.barcode ?? null,
        data.name ?? null,
        data.category ?? null,
        data.cost_price ?? null,
        data.retail_price ?? null,
        data.min_stock_level ?? null,
        data.image_url ?? null,
        id,
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

    const placeholders = ids.map(() => "?").join(", ");
    params.push(...ids);

    const result = this.db
      .prepare(
        `UPDATE ${this.tableName} SET ${setClauses.join(", ")} WHERE id IN (${placeholders})`,
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
    const result = this.db
      .prepare(
        `UPDATE ${this.tableName} SET is_active = 0 WHERE id IN (${placeholders})`,
      )
      .run(...(ids as any[]));

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
    },
  ): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET
          barcode = ?, name = ?, category = ?, category_id = ?, cost_price_usd = ?, 
          selling_price_usd = ?, min_stock_level = ?, image_url = ?,
          supplier = ?, stock_quantity = COALESCE(?, stock_quantity)
        WHERE id = ?
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
        id,
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
   * Adjust stock quantity (set to absolute value)
   */
  adjustStock(id: number, newQuantity: number): boolean {
    try {
      const result = this.execute(
        `UPDATE ${this.tableName} SET stock_quantity = ? WHERE id = ?`,
        newQuantity,
        id,
      );
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to adjust stock", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Increment/decrement stock quantity
   */
  adjustStockDelta(id: number, delta: number): boolean {
    try {
      const result = this.execute(
        `UPDATE ${this.tableName} SET stock_quantity = stock_quantity + ? WHERE id = ? AND is_active = 1`,
        delta,
        id,
      );
      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to adjust stock delta", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Deduct stock for multiple products (used when finalizing a sale)
   */
  deductStockForSale(saleId: number): void {
    try {
      this.execute(
        `
        UPDATE ${this.tableName}
        SET stock_quantity = stock_quantity - (
          SELECT quantity 
          FROM sale_items 
          WHERE sale_items.product_id = products.id AND sale_items.sale_id = ?
        )
        WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = ?)
      `,
        saleId,
        saleId,
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
      const result = this.queryOne<StockStats>(`
        SELECT 
          COALESCE(SUM(cost_price_usd * stock_quantity), 0) AS stock_budget_usd,
          COALESCE(SUM(stock_quantity), 0) AS stock_count
        FROM ${this.tableName}
        WHERE is_active = 1
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
      `);
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
      return this.query<LowStockProduct>(`
        SELECT id, name, stock_quantity, min_stock_level
        FROM ${this.tableName}
        WHERE stock_quantity <= min_stock_level AND is_active = 1
          AND item_type NOT IN ('Virtual_MTC', 'Virtual_Alfa')
        ORDER BY name ASC
      `);
    } catch (error) {
      throw new DatabaseError("Failed to get low stock products", {
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

      let query = `
        SELECT 
          id, barcode, name, category, stock_quantity, min_stock_level, 
          image_url, is_active, created_at,
          cost_price_usd as cost_price, 
          selling_price_usd as retail_price
        FROM ${this.tableName} 
        WHERE is_active = 1 AND (name LIKE ? OR barcode LIKE ?)
      `;
      const params: (string | number)[] = [searchTerm, searchTerm];

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
      const results = this.query<{ category: string }>(`
        SELECT DISTINCT category FROM ${this.tableName} 
        WHERE is_active = 1 AND category IS NOT NULL AND category != ''
        ORDER BY category ASC
      `);
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

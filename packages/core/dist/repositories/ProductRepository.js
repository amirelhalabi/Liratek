/**
 * Product Repository
 *
 * Handles all database operations for products/inventory.
 * Extends BaseRepository for standard CRUD operations.
 */
import { BaseRepository, } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
// =============================================================================
// Repository
// =============================================================================
export class ProductRepository extends BaseRepository {
    constructor() {
        super("products", { softDelete: true });
    }
    // ---------------------------------------------------------------------------
    // Product-Specific Queries
    // ---------------------------------------------------------------------------
    /**
     * Get all products with optional search filter (as DTOs for frontend)
     */
    findAllProducts(search) {
        try {
            let query = `
        SELECT 
          id, barcode, name, category, stock_quantity, min_stock_level, 
          image_url, is_active, created_at,
          cost_price_usd as cost_price, 
          selling_price_usd as retail_price
        FROM ${this.tableName} 
        WHERE is_active = 1
      `;
            const params = [];
            if (search) {
                query += ` AND (name LIKE ? OR barcode LIKE ? OR category LIKE ?)`;
                const term = `%${search}%`;
                params.push(term, term, term);
            }
            query += ` ORDER BY name ASC`;
            return this.query(query, ...params);
        }
        catch (error) {
            throw new DatabaseError("Failed to find products", { cause: error });
        }
    }
    /**
     * Get paginated products with search filter
     */
    findProductsPaginated(options = {}) {
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
    findByBarcode(barcode) {
        try {
            const query = `SELECT * FROM ${this.tableName} WHERE barcode = ? AND is_active = 1`;
            return this.queryOne(query, barcode);
        }
        catch (error) {
            throw new DatabaseError("Failed to find product by barcode", {
                cause: error,
            });
        }
    }
    /**
     * Check if barcode already exists
     */
    barcodeExists(barcode, excludeId) {
        try {
            const query = excludeId
                ? `SELECT 1 FROM ${this.tableName} WHERE barcode = ? AND id != ?`
                : `SELECT 1 FROM ${this.tableName} WHERE barcode = ?`;
            const params = excludeId ? [barcode, excludeId] : [barcode];
            return this.queryOne(query, ...params) !== null;
        }
        catch (error) {
            throw new DatabaseError("Failed to check barcode existence", {
                cause: error,
            });
        }
    }
    /**
     * Create a new product
     */
    createProduct(data) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (
          barcode, name, category, cost_price_usd, selling_price_usd, 
          stock_quantity, min_stock_level, image_url, item_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
            const result = stmt.run(data.barcode, data.name, data.category, data.cost_price, data.retail_price, data.stock_quantity ?? 0, data.min_stock_level ?? 5, data.image_url ?? null, data.item_type ?? "Product");
            return { id: result.lastInsertRowid };
        }
        catch (error) {
            const code = error?.code;
            if (code === "SQLITE_CONSTRAINT_UNIQUE") {
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
    updateProduct(id, data) {
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
            const result = stmt.run(data.barcode ?? null, data.name ?? null, data.category ?? null, data.cost_price ?? null, data.retail_price ?? null, data.min_stock_level ?? null, data.image_url ?? null, id);
            return result.changes > 0;
        }
        catch (error) {
            const code = error?.code;
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
    updateProductFull(id, data) {
        try {
            const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET
          barcode = ?, name = ?, category = ?, cost_price_usd = ?, 
          selling_price_usd = ?, min_stock_level = ?, image_url = ?
        WHERE id = ?
      `);
            const result = stmt.run(data.barcode, data.name, data.category, data.cost_price, data.retail_price, data.min_stock_level, data.image_url ?? null, id);
            return result.changes > 0;
        }
        catch (error) {
            const code = error?.code;
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
    adjustStock(id, newQuantity) {
        try {
            const result = this.execute(`UPDATE ${this.tableName} SET stock_quantity = ? WHERE id = ?`, newQuantity, id);
            return result.changes > 0;
        }
        catch (error) {
            throw new DatabaseError("Failed to adjust stock", {
                cause: error,
                entityId: id,
            });
        }
    }
    /**
     * Increment/decrement stock quantity
     */
    adjustStockDelta(id, delta) {
        try {
            const result = this.execute(`UPDATE ${this.tableName} SET stock_quantity = stock_quantity + ? WHERE id = ? AND is_active = 1`, delta, id);
            return result.changes > 0;
        }
        catch (error) {
            throw new DatabaseError("Failed to adjust stock delta", {
                cause: error,
                entityId: id,
            });
        }
    }
    /**
     * Deduct stock for multiple products (used when finalizing a sale)
     */
    deductStockForSale(saleId) {
        try {
            this.execute(`
        UPDATE ${this.tableName}
        SET stock_quantity = stock_quantity - (
          SELECT quantity 
          FROM sale_items 
          WHERE sale_items.product_id = products.id AND sale_items.sale_id = ?
        )
        WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = ?)
      `, saleId, saleId);
        }
        catch (error) {
            throw new DatabaseError("Failed to deduct stock for sale", {
                cause: error,
            });
        }
    }
    /**
     * Get stock statistics (budget and count)
     */
    getStockStats() {
        try {
            const result = this.queryOne(`
        SELECT 
          COALESCE(SUM(cost_price_usd * stock_quantity), 0) AS stock_budget_usd,
          COALESCE(SUM(stock_quantity), 0) AS stock_count
        FROM ${this.tableName}
        WHERE is_active = 1
      `);
            return result ?? { stock_budget_usd: 0, stock_count: 0 };
        }
        catch (error) {
            throw new DatabaseError("Failed to get stock stats", { cause: error });
        }
    }
    /**
     * Get products that are at or below minimum stock level
     */
    findLowStock() {
        try {
            return this.query(`
        SELECT id, name, stock_quantity, min_stock_level
        FROM ${this.tableName}
        WHERE stock_quantity <= min_stock_level AND is_active = 1
        ORDER BY name ASC
      `);
        }
        catch (error) {
            throw new DatabaseError("Failed to get low stock products", {
                cause: error,
            });
        }
    }
    /**
     * Get virtual stock (MTC + Alfa recharge inventory)
     */
    getVirtualStock() {
        try {
            const result = this.queryOne(`
        SELECT COALESCE(SUM(stock_quantity), 0) as total 
        FROM ${this.tableName} 
        WHERE item_type IN ('Virtual_MTC', 'Virtual_Alfa') AND is_active = 1
      `);
            return result?.total ?? 0;
        }
        catch (error) {
            throw new DatabaseError("Failed to get virtual stock", { cause: error });
        }
    }
    /**
     * Search products by multiple criteria
     */
    search(term, options = {}) {
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
            const params = [searchTerm, searchTerm];
            if (category) {
                query += ` AND category = ?`;
                params.push(category);
            }
            query += ` ORDER BY name ASC LIMIT ?`;
            params.push(limit);
            return this.query(query, ...params);
        }
        catch (error) {
            throw new DatabaseError("Failed to search products", { cause: error });
        }
    }
    /**
     * Get all distinct categories
     */
    getCategories() {
        try {
            const results = this.query(`
        SELECT DISTINCT category FROM ${this.tableName} 
        WHERE is_active = 1 AND category IS NOT NULL AND category != ''
        ORDER BY category ASC
      `);
            return results.map((r) => r.category);
        }
        catch (error) {
            throw new DatabaseError("Failed to get categories", { cause: error });
        }
    }
}
// =============================================================================
// Singleton Instance
// =============================================================================
let productRepositoryInstance = null;
export function getProductRepository() {
    if (!productRepositoryInstance) {
        productRepositoryInstance = new ProductRepository();
    }
    return productRepositoryInstance;
}
/** Reset the singleton (for testing) */
export function resetProductRepository() {
    productRepositoryInstance = null;
}

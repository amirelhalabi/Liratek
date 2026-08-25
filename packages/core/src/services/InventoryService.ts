/**
 * Inventory Service
 *
 * Business logic layer for inventory/product operations.
 * Uses ProductRepository for data access.
 *
 * This service encapsulates:
 * - Product CRUD operations
 * - Stock management
 * - Low stock alerts
 * - Category management
 */

import {
  ProductRepository,
  getProductRepository,
  StockAdjustmentRepository,
  getStockAdjustmentRepository,
  ProductUnitRepository,
  getProductUnitRepository,
  type ProductDTO,
  type CreateProductData,
  type UpdateProductData,
  type StockStats,
  type LowStockProduct,
  type NegativeStockProduct,
  type StockAdjustmentWithUser,
  type ProductEntity,
  type ProductUnitEntity,
} from "../repositories/index.js";
import { ValidationError, NotFoundError } from "../utils/errors.js";
import { toErrorString, getRepoConstraintCode } from "../utils/errors.js";
import {
  generateUniqueNumericBarcode,
  suggestDuplicateBarcode,
} from "../utils/barcode.js";
import { inventoryLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface ProductResult {
  success: boolean;
  id?: number;
  error?: string;
  code?: "DUPLICATE_BARCODE";
  suggested_barcode?: string;
}

export interface StockAdjustmentResult {
  success: boolean;
  error?: string;
}

/**
 * Result of {@link InventoryService.resolveScanCode} — the resolved
 * product plus the specific unit the scanned code identified, when the
 * code was an IMEI rather than a barcode (LIRA-143 Phase 3, owner decision
 * #2). `matched_unit` is `null` on a barcode hit — barcode resolves the
 * model only, never a specific unit.
 */
export interface ScanCodeResolution {
  product: ProductEntity;
  matched_unit: ProductUnitEntity | null;
}

// =============================================================================
// Inventory Service Class
// =============================================================================

export class InventoryService {
  private productRepo: ProductRepository;
  private stockAdjustmentRepo: StockAdjustmentRepository;
  private productUnitRepo: ProductUnitRepository;

  constructor(
    productRepo?: ProductRepository,
    stockAdjustmentRepo?: StockAdjustmentRepository,
    productUnitRepo?: ProductUnitRepository,
  ) {
    this.productRepo = productRepo ?? getProductRepository();
    this.stockAdjustmentRepo =
      stockAdjustmentRepo ?? getStockAdjustmentRepository();
    this.productUnitRepo = productUnitRepo ?? getProductUnitRepository();
  }

  // ---------------------------------------------------------------------------
  // Product Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all products with optional search filter
   */
  getProducts(search?: string): ProductDTO[] {
    return this.productRepo.findAllProducts(search);
  }

  /**
   * Get a single product by ID
   */
  getProductById(id: number) {
    const product = this.productRepo.findById(id);
    if (!product) {
      throw new NotFoundError("Product", id);
    }
    return product;
  }

  /**
   * Get a product by barcode
   */
  getProductByBarcode(barcode: string) {
    if (!barcode?.trim()) {
      throw new ValidationError("Barcode is required");
    }
    return this.productRepo.findByBarcode(barcode.trim());
  }

  /**
   * Search products by name or barcode
   */
  searchProducts(
    term: string,
    options?: { limit?: number; category?: string },
  ) {
    if (!term?.trim()) {
      return [];
    }
    return this.productRepo.search(term.trim(), options);
  }

  /**
   * Resolve a scanned/typed code the same way everywhere a scanner feeds
   * this app (LIRA-143 Phase 3, owner decision #2): barcode first, then —
   * only when no product has that exact barcode — an active (`IN_STOCK`)
   * unit IMEI. An IMEI hit resolves the owning product AND preselects the
   * specific unit, since scanning one phone's IMEI means the operator
   * means that unit, not just "some unit of this model". Returns `null`
   * for a blank code or a code that matches neither. `findById` already
   * excludes soft-deleted/inactive rows (`ProductRepository`'s
   * `getBaseWhere`), so a dangling `product_units.product_id` — a unit
   * whose product was deleted after intake — is logged and treated as "no
   * match" rather than thrown, since a scan is a lookup, not a write that
   * should fail loudly.
   */
  resolveScanCode(code: string): ScanCodeResolution | null {
    const trimmed = code?.trim();
    if (!trimmed) {
      return null;
    }

    const byBarcode = this.productRepo.findByBarcode(trimmed);
    if (byBarcode) {
      return { product: byBarcode, matched_unit: null };
    }

    const unit = this.productUnitRepo.findActiveByImei(trimmed);
    if (!unit) {
      return null;
    }

    const product = this.productRepo.findById(unit.product_id);
    if (!product) {
      inventoryLogger.warn(
        { imei: trimmed, unitId: unit.id, productId: unit.product_id },
        "resolveScanCode: active unit's product not found or inactive",
      );
      return null;
    }

    return { product, matched_unit: unit };
  }

  /**
   * Get all product categories
   */
  getCategories(): string[] {
    return this.productRepo.getCategories();
  }

  // ---------------------------------------------------------------------------
  // Product CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new product
   */
  createProduct(data: CreateProductData): ProductResult {
    // Barcode behavior:
    // - If blank, auto-generate a unique 8-digit numeric barcode.
    // - If provided and duplicates exist, return a structured duplicate error.
    let barcode = data.barcode?.trim() || "";
    if (!barcode) {
      barcode = generateUniqueNumericBarcode((code: string) =>
        this.productRepo.barcodeExists(code),
      );
    }
    if (!data.name?.trim()) {
      return { success: false, error: "Product name is required" };
    }
    if (!data.category?.trim()) {
      return { success: false, error: "Category is required" };
    }
    if (data.cost_price < 0) {
      return { success: false, error: "Cost price cannot be negative" };
    }
    if (data.retail_price < 0) {
      return { success: false, error: "Retail price cannot be negative" };
    }
    if (
      data.retail_price > 0 &&
      data.cost_price > 0 &&
      data.retail_price <= data.cost_price
    ) {
      return {
        success: false,
        error: "Selling price must be greater than cost price",
      };
    }

    // Check for duplicate barcode
    if (barcode && this.productRepo.barcodeExists(barcode)) {
      const suggested = suggestDuplicateBarcode(barcode, (code: string) =>
        this.productRepo.barcodeExists(code),
      );
      return {
        success: false,
        error: "Barcode already exists",
        code: "DUPLICATE_BARCODE",
        suggested_barcode: suggested,
      };
    }

    try {
      const result = this.productRepo.createProduct({
        ...data,
        barcode,
        name: data.name.trim(),
        category: data.category.trim(),
      });
      return { success: true, id: result.id };
    } catch (error) {
      const repoCode = getRepoConstraintCode(error);
      if (repoCode === "DUPLICATE_BARCODE") {
        return { success: false, error: "Barcode already exists" };
      }
      inventoryLogger.error({ error, data }, "Create product error");
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Update an existing product
   */
  batchUpdateProducts(
    ids: number[],
    data: {
      category?: string;
      min_stock_level?: number;
      supplier?: string | null;
    },
  ): { success: boolean; updated: number; error?: string } {
    if (!ids || ids.length === 0) {
      return { success: false, updated: 0, error: "No products selected" };
    }
    const hasField =
      data.category !== undefined ||
      data.min_stock_level !== undefined ||
      data.supplier !== undefined;
    if (!hasField) {
      return { success: false, updated: 0, error: "No fields to update" };
    }
    try {
      const updated = this.productRepo.batchUpdateProducts(ids, data);
      return { success: true, updated };
    } catch (err) {
      return { success: false, updated: 0, error: String(err) };
    }
  }

  updateProduct(
    id: number,
    data: UpdateProductData & {
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
  ): ProductResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }

    // Check if product exists
    if (!this.productRepo.exists(id)) {
      return { success: false, error: "Product not found" };
    }

    if (
      data.retail_price > 0 &&
      data.cost_price > 0 &&
      data.retail_price <= data.cost_price
    ) {
      return {
        success: false,
        error: "Selling price must be greater than cost price",
      };
    }

    // Check for duplicate barcode (excluding this product)
    if (data.barcode && this.productRepo.barcodeExists(data.barcode, id)) {
      const suggested = suggestDuplicateBarcode(data.barcode, (code: string) =>
        this.productRepo.barcodeExists(code, id),
      );
      return {
        success: false,
        error: "Barcode already exists",
        code: "DUPLICATE_BARCODE",
        suggested_barcode: suggested,
      };
    }

    try {
      this.productRepo.updateProductFull(id, {
        barcode: data.barcode,
        name: data.name,
        category: data.category,
        category_id: data.category_id ?? null,
        cost_price: data.cost_price,
        retail_price: data.retail_price,
        min_stock_level: data.min_stock_level,
        ...(data.image_url != null ? { image_url: data.image_url } : {}),
        supplier: data.supplier ?? null,
        stock_quantity: data.stock_quantity,
        warranty_months: data.warranty_months,
      });
      return { success: true };
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "DUPLICATE_BARCODE") {
        return { success: false, error: "Barcode already exists" };
      }
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Soft delete a product
   */
  deleteProduct(id: number): ProductResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }

    try {
      this.productRepo.softDeleteById(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Soft delete multiple products in a single operation.
   * Returns `{ success, deleted }` with the count of affected rows.
   */
  batchDeleteProducts(ids: number[]): {
    success: boolean;
    deleted?: number;
    error?: string;
  } {
    if (!ids || ids.length === 0) {
      return { success: false, error: "No product IDs provided" };
    }
    try {
      const deleted = this.productRepo.batchSoftDelete(ids);
      return { success: true, deleted };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  // ---------------------------------------------------------------------------
  // Stock Management
  // ---------------------------------------------------------------------------

  /**
   * Set stock to absolute value.
   *
   * LIRA-077: `reason` and `userId` are required — every manual correction
   * is written to the `stock_adjustments` audit trail (ProductRepository
   * owns the repo-level transaction; this service never touches the DB).
   * `userId` is null only when the caller genuinely couldn't attribute one
   * (e.g. auth lookup failed) — the FK is ON DELETE SET NULL, so the column
   * itself is nullable, but every real caller should supply a userId.
   */
  adjustStock(
    id: number,
    newQuantity: number,
    reason: string,
    userId: number | null,
  ): StockAdjustmentResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }
    if (newQuantity < 0) {
      return { success: false, error: "Stock quantity cannot be negative" };
    }
    if (!reason?.trim()) {
      return { success: false, error: "Reason is required" };
    }

    try {
      const changed = this.productRepo.adjustStock(
        id,
        newQuantity,
        reason.trim(),
        userId ?? null,
      );
      if (!changed) {
        return { success: false, error: "Product not found" };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Increment or decrement stock by a delta.
   *
   * LIRA-077: same reason/userId + audit-trail contract as {@link adjustStock}.
   */
  adjustStockDelta(
    id: number,
    delta: number,
    reason: string,
    userId: number | null,
  ): StockAdjustmentResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }
    if (!reason?.trim()) {
      return { success: false, error: "Reason is required" };
    }

    try {
      const changed = this.productRepo.adjustStockDelta(
        id,
        delta,
        reason.trim(),
        userId ?? null,
      );
      if (!changed) {
        return { success: false, error: "Product not found" };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Stock adjustment audit history — scoped to one product, or the most
   * recent adjustments across all products when productId is omitted.
   */
  getStockAdjustments(productId?: number): StockAdjustmentWithUser[] {
    if (productId) {
      return this.stockAdjustmentRepo.getByProduct(productId);
    }
    return this.stockAdjustmentRepo.getRecent();
  }

  /**
   * Deduct stock for a completed sale
   */
  deductStockForSale(saleId: number): void {
    this.productRepo.deductStockForSale(saleId);
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  /**
   * Get stock statistics (budget and count)
   */
  getStockStats(): StockStats {
    return this.productRepo.getStockStats();
  }

  /**
   * Get products that are at or below minimum stock level
   */
  getLowStockProducts(): LowStockProduct[] {
    return this.productRepo.findLowStock();
  }

  /**
   * Products at negative stock (oversold — need reconciliation).
   */
  getNegativeStockProducts(): NegativeStockProduct[] {
    return this.productRepo.findNegativeStock();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let inventoryServiceInstance: InventoryService | null = null;

export function getInventoryService(): InventoryService {
  if (!inventoryServiceInstance) {
    inventoryServiceInstance = new InventoryService();
  }
  return inventoryServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetInventoryService(): void {
  inventoryServiceInstance = null;
}

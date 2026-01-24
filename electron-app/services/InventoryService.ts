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
  type ProductDTO,
  type CreateProductData,
  type UpdateProductData,
  type StockStats,
  type LowStockProduct,
} from "../database/repositories/index.js";
import { ValidationError, NotFoundError } from "../utils/errors.js";
import { toErrorString, getRepoConstraintCode } from "../utils/errors.js";
import { generateUniqueNumericBarcode, suggestDuplicateBarcode } from "../utils/barcode.js";

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

// =============================================================================
// Inventory Service Class
// =============================================================================

export class InventoryService {
  private productRepo: ProductRepository;

  constructor(productRepo?: ProductRepository) {
    this.productRepo = productRepo ?? getProductRepository();
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
      console.error("Create product error:", error);
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Update an existing product
   */
  updateProduct(
    id: number,
    data: UpdateProductData & {
      barcode: string;
      name: string;
      category: string;
      cost_price: number;
      retail_price: number;
      min_stock_level: number;
      image_url?: string | null;
    },
  ): ProductResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }

    // Check if product exists
    if (!this.productRepo.exists(id)) {
      return { success: false, error: "Product not found" };
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
        cost_price: data.cost_price,
        retail_price: data.retail_price,
        min_stock_level: data.min_stock_level,
        ...(data.image_url != null ? { image_url: data.image_url } : {}),
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

  // ---------------------------------------------------------------------------
  // Stock Management
  // ---------------------------------------------------------------------------

  /**
   * Set stock to absolute value
   */
  adjustStock(id: number, newQuantity: number): StockAdjustmentResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }
    if (newQuantity < 0) {
      return { success: false, error: "Stock quantity cannot be negative" };
    }

    try {
      this.productRepo.adjustStock(id, newQuantity);
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /**
   * Increment or decrement stock by a delta
   */
  adjustStockDelta(id: number, delta: number): StockAdjustmentResult {
    if (!id) {
      return { success: false, error: "Product ID required" };
    }

    try {
      this.productRepo.adjustStockDelta(id, delta);
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
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
   * Get virtual stock (MTC + Alfa recharge inventory)
   */
  getVirtualStock(): number {
    return this.productRepo.getVirtualStock();
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

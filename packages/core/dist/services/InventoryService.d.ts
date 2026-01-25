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
import { ProductRepository, type ProductDTO, type CreateProductData, type UpdateProductData, type StockStats, type LowStockProduct } from "../repositories/index.js";
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
export declare class InventoryService {
    private productRepo;
    constructor(productRepo?: ProductRepository);
    /**
     * Get all products with optional search filter
     */
    getProducts(search?: string): ProductDTO[];
    /**
     * Get a single product by ID
     */
    getProductById(id: number): import("../index.js").Product;
    /**
     * Get a product by barcode
     */
    getProductByBarcode(barcode: string): import("../index.js").Product | null;
    /**
     * Search products by name or barcode
     */
    searchProducts(term: string, options?: {
        limit?: number;
        category?: string;
    }): ProductDTO[];
    /**
     * Get all product categories
     */
    getCategories(): string[];
    /**
     * Create a new product
     */
    createProduct(data: CreateProductData): ProductResult;
    /**
     * Update an existing product
     */
    updateProduct(id: number, data: UpdateProductData & {
        barcode: string;
        name: string;
        category: string;
        cost_price: number;
        retail_price: number;
        min_stock_level: number;
        image_url?: string | null;
    }): ProductResult;
    /**
     * Soft delete a product
     */
    deleteProduct(id: number): ProductResult;
    /**
     * Set stock to absolute value
     */
    adjustStock(id: number, newQuantity: number): StockAdjustmentResult;
    /**
     * Increment or decrement stock by a delta
     */
    adjustStockDelta(id: number, delta: number): StockAdjustmentResult;
    /**
     * Deduct stock for a completed sale
     */
    deductStockForSale(saleId: number): void;
    /**
     * Get stock statistics (budget and count)
     */
    getStockStats(): StockStats;
    /**
     * Get products that are at or below minimum stock level
     */
    getLowStockProducts(): LowStockProduct[];
    /**
     * Get virtual stock (MTC + Alfa recharge inventory)
     */
    getVirtualStock(): number;
}
export declare function getInventoryService(): InventoryService;
/** Reset the singleton (for testing) */
export declare function resetInventoryService(): void;

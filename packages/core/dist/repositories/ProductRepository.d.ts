/**
 * Product Repository
 *
 * Handles all database operations for products/inventory.
 * Extends BaseRepository for standard CRUD operations.
 */
import { BaseRepository, type FindOptions, type PaginatedResult } from "./BaseRepository.js";
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
    is_active: number;
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
    created_at: string;
}
export interface CreateProductData {
    barcode: string;
    name: string;
    category: string;
    cost_price: number;
    retail_price: number;
    stock_quantity?: number;
    min_stock_level?: number;
    image_url?: string;
    item_type?: string;
}
export interface UpdateProductData {
    barcode?: string;
    name?: string;
    category?: string;
    cost_price?: number;
    retail_price?: number;
    min_stock_level?: number;
    image_url?: string;
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
export declare class ProductRepository extends BaseRepository<ProductEntity> {
    constructor();
    /**
     * Get all products with optional search filter (as DTOs for frontend)
     */
    findAllProducts(search?: string): ProductDTO[];
    /**
     * Get paginated products with search filter
     */
    findProductsPaginated(options?: FindOptions & {
        search?: string;
    }): PaginatedResult<ProductDTO>;
    /**
     * Get product by barcode
     */
    findByBarcode(barcode: string): ProductEntity | null;
    /**
     * Check if barcode already exists
     */
    barcodeExists(barcode: string, excludeId?: number): boolean;
    /**
     * Create a new product
     */
    createProduct(data: CreateProductData): {
        id: number;
    };
    /**
     * Update an existing product
     */
    updateProduct(id: number, data: UpdateProductData): boolean;
    /**
     * Update product with all fields explicitly (for handler compatibility)
     */
    updateProductFull(id: number, data: {
        barcode: string;
        name: string;
        category: string;
        cost_price: number;
        retail_price: number;
        min_stock_level: number;
        image_url?: string | null;
    }): boolean;
    /**
     * Adjust stock quantity (set to absolute value)
     */
    adjustStock(id: number, newQuantity: number): boolean;
    /**
     * Increment/decrement stock quantity
     */
    adjustStockDelta(id: number, delta: number): boolean;
    /**
     * Deduct stock for multiple products (used when finalizing a sale)
     */
    deductStockForSale(saleId: number): void;
    /**
     * Get stock statistics (budget and count)
     */
    getStockStats(): StockStats;
    /**
     * Get products that are at or below minimum stock level
     */
    findLowStock(): LowStockProduct[];
    /**
     * Get virtual stock (MTC + Alfa recharge inventory)
     */
    getVirtualStock(): number;
    /**
     * Search products by multiple criteria
     */
    search(term: string, options?: {
        limit?: number;
        category?: string;
    }): ProductDTO[];
    /**
     * Get all distinct categories
     */
    getCategories(): string[];
}
export declare function getProductRepository(): ProductRepository;
/** Reset the singleton (for testing) */
export declare function resetProductRepository(): void;

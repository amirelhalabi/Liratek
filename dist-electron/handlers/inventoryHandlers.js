"use strict";
/**
 * Inventory IPC Handlers
 *
 * Thin wrapper around InventoryService for IPC communication.
 * Handles authentication checks and delegates to service layer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInventoryHandlers = registerInventoryHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
const logger_1 = require("../utils/logger");
// =============================================================================
// Handler Registration
// =============================================================================
function registerInventoryHandlers() {
    const service = (0, services_1.getInventoryService)();
    // ---------------------------------------------------------------------------
    // Product Queries (No auth required for read operations)
    // ---------------------------------------------------------------------------
    // Get all products (optional filter by name/barcode)
    electron_1.ipcMain.handle("inventory:get-products", (_event, search) => {
        return service.getProducts(search);
    });
    // Get single product by ID
    electron_1.ipcMain.handle("inventory:get-product", (_event, id) => {
        try {
            return service.getProductById(id);
        }
        catch (_error) {
            return null;
        }
    });
    // Get product by barcode
    electron_1.ipcMain.handle("inventory:get-product-by-barcode", (_event, barcode) => {
        return service.getProductByBarcode(barcode);
    });
    // ---------------------------------------------------------------------------
    // Product CRUD (Admin only)
    // ---------------------------------------------------------------------------
    // Create product
    electron_1.ipcMain.handle("inventory:create-product", (e, product) => {
        // Auth check
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        logger_1.inventoryLogger.debug({ barcode: product.barcode, name: product.name }, "Creating product");
        return service.createProduct({
            barcode: product.barcode,
            name: product.name,
            category: product.category,
            cost_price: product.cost_price,
            retail_price: product.retail_price,
            ...(product.stock_quantity != null ? { stock_quantity: product.stock_quantity } : {}),
            ...(product.min_stock_level != null ? { min_stock_level: product.min_stock_level } : {}),
            ...(product.image_url != null ? { image_url: product.image_url } : {}),
        });
    });
    // Update product
    electron_1.ipcMain.handle("inventory:update-product", (e, product) => {
        // Auth check
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        if (!product.id) {
            return { success: false, error: "Product ID required" };
        }
        return service.updateProduct(product.id, {
            barcode: product.barcode,
            name: product.name,
            category: product.category,
            cost_price: product.cost_price,
            retail_price: product.retail_price,
            min_stock_level: product.min_stock_level ?? 5,
            ...(product.image_url != null ? { image_url: product.image_url } : {}),
        });
    });
    // Soft delete product
    electron_1.ipcMain.handle("inventory:delete-product", (e, id) => {
        // Auth check
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        return service.deleteProduct(id);
    });
    // ---------------------------------------------------------------------------
    // Stock Management (Admin only)
    // ---------------------------------------------------------------------------
    // Adjust stock (absolute set)
    electron_1.ipcMain.handle("inventory:adjust-stock", (e, id, newQuantity) => {
        // Auth check
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        return service.adjustStock(id, newQuantity);
    });
    // ---------------------------------------------------------------------------
    // Reporting (No auth required)
    // ---------------------------------------------------------------------------
    // Get Inventory Stock Stats (budget and count)
    electron_1.ipcMain.handle("inventory:get-stock-stats", () => {
        try {
            return service.getStockStats();
        }
        catch (error) {
            console.error("Failed to get stock stats:", error);
            return { stock_budget_usd: 0, stock_count: 0 };
        }
    });
    // Get low stock products
    electron_1.ipcMain.handle("inventory:get-low-stock-products", () => {
        try {
            return service.getLowStockProducts();
        }
        catch (error) {
            console.error("Failed to get low stock products:", error);
            return [];
        }
    });
}

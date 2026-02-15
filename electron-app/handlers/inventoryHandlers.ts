/**
 * Inventory IPC Handlers
 *
 * Thin wrapper around InventoryService for IPC communication.
 * Handles authentication checks and delegates to service layer.
 */

import { ipcMain } from "electron";
import { getInventoryService, inventoryLogger } from "@liratek/core";
/* eslint-disable @typescript-eslint/no-require-imports */

// =============================================================================
// Types
// =============================================================================

interface ProductInput {
  id?: number;
  barcode: string;
  name: string;
  category: string;
  cost_price: number;
  retail_price: number;
  whish_price?: number;
  stock_quantity?: number;
  min_stock_level?: number;
  image_url?: string;
}

// =============================================================================
// Handler Registration
// =============================================================================

export function registerInventoryHandlers(): void {
  const service = getInventoryService();

  // ---------------------------------------------------------------------------
  // Product Queries (No auth required for read operations)
  // ---------------------------------------------------------------------------

  // Get all products (optional filter by name/barcode)
  ipcMain.handle("inventory:get-products", (_event, search?: string) => {
    return service.getProducts(search);
  });

  // Get single product by ID
  ipcMain.handle("inventory:get-product", (_event, id: number) => {
    try {
      return service.getProductById(id);
    } catch (_error) {
      return null;
    }
  });

  // Get product by barcode
  ipcMain.handle(
    "inventory:get-product-by-barcode",
    (_event, barcode: string) => {
      return service.getProductByBarcode(barcode);
    },
  );

  // ---------------------------------------------------------------------------
  // Product CRUD (Admin only)
  // ---------------------------------------------------------------------------

  // Create product
  ipcMain.handle("inventory:create-product", (e, product: ProductInput) => {
    // Auth check
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    inventoryLogger.debug(
      { barcode: product.barcode, name: product.name },
      "Creating product",
    );
    return service.createProduct({
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      cost_price: product.cost_price,
      retail_price: product.retail_price,
      ...(product.stock_quantity != null
        ? { stock_quantity: product.stock_quantity }
        : {}),
      ...(product.min_stock_level != null
        ? { min_stock_level: product.min_stock_level }
        : {}),
      ...(product.image_url != null ? { image_url: product.image_url } : {}),
    });
  });

  // Update product
  ipcMain.handle("inventory:update-product", (e, product: ProductInput) => {
    // Auth check
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

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
  ipcMain.handle("inventory:delete-product", (e, id: number) => {
    // Auth check
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    return service.deleteProduct(id);
  });

  // ---------------------------------------------------------------------------
  // Stock Management (Admin only)
  // ---------------------------------------------------------------------------

  // Adjust stock (absolute set)
  ipcMain.handle(
    "inventory:adjust-stock",
    (e, id: number, newQuantity: number) => {
      // Auth check
      try {
        const { requireRole } = require("../session");
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      return service.adjustStock(id, newQuantity);
    },
  );

  // ---------------------------------------------------------------------------
  // Reporting (No auth required)
  // ---------------------------------------------------------------------------

  // Get Inventory Stock Stats (budget and count)
  ipcMain.handle("inventory:get-stock-stats", () => {
    try {
      return service.getStockStats();
    } catch (error) {
      inventoryLogger.error({ error }, "Failed to get stock stats");
      return { stock_budget_usd: 0, stock_count: 0 };
    }
  });

  // Get low stock products
  ipcMain.handle("inventory:get-low-stock-products", () => {
    try {
      return service.getLowStockProducts();
    } catch (error) {
      inventoryLogger.error({ error }, "Failed to get low stock products");
      return [];
    }
  });
}

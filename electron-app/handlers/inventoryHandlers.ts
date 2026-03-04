/**
 * Inventory IPC Handlers
 *
 * Thin wrapper around InventoryService for IPC communication.
 * Handles authentication checks and delegates to service layer.
 */

import { ipcMain } from "electron";
import {
  getInventoryService,
  inventoryLogger,
  getCategoryRepository,
  getProductSupplierRepository,
} from "@liratek/core";
import { requireRole } from "../session.js";

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
  supplier?: string | null;
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
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    inventoryLogger.debug(
      { barcode: product.barcode, name: product.name },
      "Creating product",
    );
    // Auto-create category if needed and get its ID
    const categoryName = product.category || "General";
    const categoryId = catRepo.getOrCreate(categoryName);

    // Auto-register product supplier if provided
    if (product.supplier) {
      supplierRepo.getOrCreate(product.supplier);
    }

    return service.createProduct({
      barcode: product.barcode,
      name: product.name,
      category: categoryName,
      category_id: categoryId,
      cost_price: product.cost_price,
      retail_price: product.retail_price,
      ...(product.stock_quantity != null
        ? { stock_quantity: product.stock_quantity }
        : {}),
      ...(product.min_stock_level != null
        ? { min_stock_level: product.min_stock_level }
        : {}),
      ...(product.image_url != null ? { image_url: product.image_url } : {}),
      supplier: product.supplier ?? null,
    });
  });

  // Update product
  ipcMain.handle("inventory:update-product", (e, product: ProductInput) => {
    // Auth check
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    if (!product.id) {
      return { success: false, error: "Product ID required" };
    }

    // Resolve category_id for the updated category
    const updCategoryName = product.category || "General";
    const updCategoryId = catRepo.getOrCreate(updCategoryName);

    // Auto-register product supplier if provided
    if (product.supplier) {
      supplierRepo.getOrCreate(product.supplier);
    }

    return service.updateProduct(product.id, {
      barcode: product.barcode,
      name: product.name,
      category: updCategoryName,
      category_id: updCategoryId,
      cost_price: product.cost_price,
      retail_price: product.retail_price,
      min_stock_level: product.min_stock_level ?? 5,
      ...(product.image_url != null ? { image_url: product.image_url } : {}),
      supplier: product.supplier ?? null,
    });
  });

  // Soft delete product
  ipcMain.handle(
    "inventory:batch-update",
    async (
      _event,
      payload: {
        ids: number[];
        category?: string;
        min_stock_level?: number;
        supplier?: string | null;
      },
    ) => {
      return service.batchUpdateProducts(payload.ids, {
        category: payload.category,
        min_stock_level: payload.min_stock_level,
        supplier: payload.supplier,
      });
    },
  );

  ipcMain.handle("inventory:delete-product", (e, id: number) => {
    // Auth check
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    return service.deleteProduct(id);
  });

  ipcMain.handle("inventory:batch-delete", (e, ids: number[]) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    return service.batchDeleteProducts(ids);
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

  // ---------------------------------------------------------------------------
  // Category Management
  // ---------------------------------------------------------------------------

  const catRepo = getCategoryRepository();
  const supplierRepo = getProductSupplierRepository();

  ipcMain.handle("inventory:get-categories", () => catRepo.getNames());
  ipcMain.handle("inventory:create-category", (_e, name: string) => {
    try {
      return { success: true, ...catRepo.create(name) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle(
    "inventory:update-category",
    (_e, id: number, name: string) => {
      try {
        return { success: true, updated: catRepo.update(id, name) };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  );
  ipcMain.handle("inventory:delete-category", (_e, id: number) => {
    try {
      return { success: true, deleted: catRepo.delete(id) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle("inventory:get-categories-full", () => catRepo.getAll());

  // ---------------------------------------------------------------------------
  // Product Supplier Management
  // ---------------------------------------------------------------------------

  ipcMain.handle("inventory:get-product-suppliers", () =>
    supplierRepo.getNames(),
  );
  ipcMain.handle("inventory:get-product-suppliers-full", () =>
    supplierRepo.getAllWithProductCount(),
  );
  ipcMain.handle("inventory:create-product-supplier", (_e, name: string) => {
    try {
      return { success: true, ...supplierRepo.create(name) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
  ipcMain.handle(
    "inventory:update-product-supplier",
    (_e, id: number, name: string) => {
      try {
        return { success: true, updated: supplierRepo.update(id, name) };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  );
  ipcMain.handle("inventory:delete-product-supplier", (_e, id: number) => {
    try {
      return { success: true, deleted: supplierRepo.delete(id) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
}

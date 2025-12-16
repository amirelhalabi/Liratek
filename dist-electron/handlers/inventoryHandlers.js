"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInventoryHandlers = registerInventoryHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerInventoryHandlers() {
    const db = (0, db_1.getDatabase)();
    // Get all products (optional filter by name/barcode)
    electron_1.ipcMain.handle('inventory:get-products', (_event, search) => {
        let query = `SELECT 
            id, barcode, name, category, stock_quantity, min_stock_level, image_url, is_active, created_at,
            cost_price_usd as cost_price, 
            selling_price_usd as retail_price
            FROM products WHERE is_active = 1`;
        const params = [];
        if (search) {
            query += ` AND (name LIKE ? OR barcode LIKE ? OR category LIKE ?)`;
            const term = `%${search}%`;
            params.push(term, term, term);
        }
        query += ` ORDER BY name ASC`;
        return db.prepare(query).all(...params);
    });
    // Get single product
    electron_1.ipcMain.handle('inventory:get-product', (_event, id) => {
        return db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
    });
    // Get product by barcode
    electron_1.ipcMain.handle('inventory:get-product-by-barcode', (_event, barcode) => {
        return db.prepare(`SELECT * FROM products WHERE barcode = ? AND is_active = 1`).get(barcode);
    });
    // Create product
    electron_1.ipcMain.handle('inventory:create-product', (_event, product) => {
        try {
            const stmt = db.prepare(`
        INSERT INTO products (
          barcode, name, category, cost_price_usd, selling_price_usd, 
          stock_quantity, min_stock_level, image_url, item_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
            const result = stmt.run(product.barcode, product.name, product.category, product.cost_price, // Maps to cost_price_usd
            product.retail_price, // Maps to selling_price_usd
            product.stock_quantity || 0, product.min_stock_level || 5, product.image_url || null, 'Product' // Default item_type
            );
            return { success: true, id: result.lastInsertRowid };
        }
        catch (error) {
            console.error('Create product error:', error);
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'Barcode already exists' };
            }
            return { success: false, error: error.message };
        }
    });
    // Update product
    electron_1.ipcMain.handle('inventory:update-product', (_event, product) => {
        try {
            if (!product.id)
                return { success: false, error: 'Product ID required' };
            const stmt = db.prepare(`
            UPDATE products SET
            barcode = ?, name = ?, category = ?, cost_price_usd = ?, 
            selling_price_usd = ?, min_stock_level = ?, image_url = ?
            WHERE id = ?
        `);
            stmt.run(product.barcode, product.name, product.category, product.cost_price, product.retail_price, product.min_stock_level || 5, product.image_url || null, product.id);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // Soft delete product
    electron_1.ipcMain.handle('inventory:delete-product', (_event, id) => {
        try {
            db.prepare(`UPDATE products SET is_active = 0 WHERE id = ?`).run(id);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
    // Adjust stock (absolute set or relative adjust could be implemented, keeping simple for now)
    electron_1.ipcMain.handle('inventory:adjust-stock', (_event, id, newQuantity) => {
        try {
            db.prepare(`UPDATE products SET stock_quantity = ? WHERE id = ?`).run(newQuantity, id);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }); // Missing closing brace added here
    // Get Inventory Stock Stats (budget and count)
    electron_1.ipcMain.handle('inventory:get-stock-stats', () => {
        try {
            const row = db.prepare(`
                SELECT 
                    COALESCE(SUM(cost_price_usd * stock_quantity), 0) AS stock_budget_usd,
                    COALESCE(SUM(stock_quantity), 0) AS stock_count
                FROM products
                WHERE is_active = 1
            `).get();
            return row;
        }
        catch (error) {
            console.error('Failed to get stock stats:', error);
            return { stock_budget_usd: 0, stock_count: 0 };
        }
    });
    // Get low stock products
    electron_1.ipcMain.handle('inventory:get-low-stock-products', () => {
        try {
            const lowStockProducts = db.prepare(`
                SELECT id, name, stock_quantity, min_stock_level
                FROM products
                WHERE stock_quantity <= min_stock_level AND is_active = 1
                ORDER BY name ASC
            `).all();
            return lowStockProducts;
        }
        catch (error) {
            console.error('Failed to get low stock products:', error);
            return [];
        }
    });
}

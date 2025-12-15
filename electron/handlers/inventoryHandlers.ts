import { ipcMain } from 'electron';
import { getDatabase } from '../db';

interface Product {
    id?: number;
    barcode: string;
    name: string;
    category: string;
    cost_price: number;
    retail_price: number;
    whish_price: number;
    stock_quantity: number;
    min_stock_level: number;
    image_url?: string;
}

export function registerInventoryHandlers(): void {
    const db = getDatabase();

    // Get all products (optional filter by name/barcode)
    ipcMain.handle('inventory:get-products', (_event, search?: string) => {
        let query = `SELECT 
            id, barcode, name, category, stock_quantity, min_stock_level, image_url, is_active, created_at,
            cost_price_usd as cost_price, 
            selling_price_usd as retail_price
            FROM products WHERE is_active = 1`;
        const params: (string | number)[] = [];

        if (search) {
            query += ` AND (name LIKE ? OR barcode LIKE ? OR category LIKE ?)`;
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        query += ` ORDER BY name ASC`;
        return db.prepare(query).all(...params);
    });

    // Get single product
    ipcMain.handle('inventory:get-product', (_event, id: number) => {
        return db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
    });

    // Get product by barcode
    ipcMain.handle('inventory:get-product-by-barcode', (_event, barcode: string) => {
        return db.prepare(`SELECT * FROM products WHERE barcode = ? AND is_active = 1`).get(barcode);
    });

    // Create product
    ipcMain.handle('inventory:create-product', (_event, product: Product) => {
        try {
            const stmt = db.prepare(`
        INSERT INTO products (
          barcode, name, category, cost_price_usd, selling_price_usd, 
          stock_quantity, min_stock_level, image_url, item_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

            const result = stmt.run(
                product.barcode,
                product.name,
                product.category,
                product.cost_price, // Maps to cost_price_usd
                product.retail_price, // Maps to selling_price_usd
                product.stock_quantity || 0,
                product.min_stock_level || 5,
                product.image_url || null,
                'Product' // Default item_type
            );

            return { success: true, id: result.lastInsertRowid };
        } catch (error: any) {
            console.error('Create product error:', error);
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return { success: false, error: 'Barcode already exists' };
            }
            return { success: false, error: error.message };
        }
    });

    // Update product
    ipcMain.handle('inventory:update-product', (_event, product: Product) => {
        try {
            if (!product.id) return { success: false, error: 'Product ID required' };

            const stmt = db.prepare(`
            UPDATE products SET
            barcode = ?, name = ?, category = ?, cost_price_usd = ?, 
            selling_price_usd = ?, min_stock_level = ?, image_url = ?
            WHERE id = ?
        `);

            stmt.run(
                product.barcode,
                product.name,
                product.category,
                product.cost_price,
                product.retail_price,
                product.min_stock_level || 5,
                product.image_url || null,
                product.id
            );

            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Soft delete product
    ipcMain.handle('inventory:delete-product', (_event, id: number) => {
        try {
            db.prepare(`UPDATE products SET is_active = 0 WHERE id = ?`).run(id);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Adjust stock (absolute set or relative adjust could be implemented, keeping simple for now)
    ipcMain.handle('inventory:adjust-stock', (_event, id: number, newQuantity: number) => {
        try {
            db.prepare(`UPDATE products SET stock_quantity = ? WHERE id = ?`).run(newQuantity, id);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
}

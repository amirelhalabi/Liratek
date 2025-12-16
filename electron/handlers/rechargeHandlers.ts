import { ipcMain } from 'electron';
import { getDatabase } from '../db';

export function registerRechargeHandlers(): void {
    const db = getDatabase();

    // Get Virtual Stock
    ipcMain.handle('recharge:get-stock', () => {
        try {
            const mtc = db.prepare("SELECT SUM(stock_quantity) as total FROM products WHERE item_type = 'Virtual_MTC'").get() as { total: number };
            const alfa = db.prepare("SELECT SUM(stock_quantity) as total FROM products WHERE item_type = 'Virtual_Alfa'").get() as { total: number };
            
            return {
                mtc: mtc?.total || 0,
                alfa: alfa?.total || 0
            };
        } catch (error) {
            console.error('Failed to get recharge stock:', error);
            return { mtc: 0, alfa: 0 };
        }
    });

    // Process Recharge Transaction (Drawer B - General Drawer)
    ipcMain.handle('recharge:process', (_event, data: {
        provider: 'MTC' | 'Alfa';
        type: 'CREDIT_TRANSFER' | 'VOUCHER' | 'DAYS';
        amount: number; // Amount in $ or Days
        cost: number; // Cost to dealer
        price: number; // Price to client
        phoneNumber?: string;
    }) => {
        const db = getDatabase();
        
        try {
            // 1. Create Sale Record
            const insertSale = db.prepare(`
                INSERT INTO sales (
                    total_amount_usd, final_amount_usd, paid_usd, status, note
                ) VALUES (?, ?, ?, 'completed', ?)
            `);

            const note = `${data.provider} ${data.type} - ${data.phoneNumber || 'No Number'}`;
            const saleResult = insertSale.run(data.price, data.price, data.price, note);
            const saleId = saleResult.lastInsertRowid;

            // 2. Deduct Virtual Stock (if applicable)
            // For simplicity, we assume we have a "Master" product for MTC and Alfa credits
            // In a real app, you might have specific products for specific vouchers
            if (data.type === 'CREDIT_TRANSFER') {
                const itemType = data.provider === 'MTC' ? 'Virtual_MTC' : 'Virtual_Alfa';
                
                // Find the "Master" virtual product or create if not exists
                let product = db.prepare("SELECT id FROM products WHERE item_type = ? LIMIT 1").get(itemType) as { id: number };
                
                if (!product) {
                    // Auto-create virtual product bucket if missing
                    const createProd = db.prepare(`
                        INSERT INTO products (name, item_type, stock_quantity, cost_price_usd, selling_price_usd)
                        VALUES (?, ?, ?, 1, 1)
                    `);
                    const res = createProd.run(`${data.provider} Virtual Credit`, itemType, 1000); // Default 1000 start
                    product = { id: Number(res.lastInsertRowid) };
                }

                // Deduct stock
                db.prepare("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?")
                  .run(data.amount, product.id);

                // Link to Sale Items
                db.prepare(`
                    INSERT INTO sale_items (sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd)
                    VALUES (?, ?, ?, ?, ?)
                `).run(saleId, product.id, data.amount, data.price, data.cost);
            }

            // Log to activity logs (Drawer B - General)
            const logStmt = db.prepare(`
                INSERT INTO activity_logs (user_id, action, details, created_at)
                VALUES (1, 'Recharge Transaction', ?, CURRENT_TIMESTAMP)
            `);
            logStmt.run(JSON.stringify({
                drawer: 'General_Drawer_B',
                provider: data.provider,
                type: data.type,
                amount: data.amount,
                price: data.price,
                cost: data.cost
            }));

            console.log(`[RECHARGE] ${data.provider} ${data.type}: ${data.amount} @ $${data.price} [Drawer B]`);
            return { success: true, saleId };
        } catch (error: any) {
            console.error('Recharge failed:', error);
            return { success: false, error: error.message };
        }
    });
}

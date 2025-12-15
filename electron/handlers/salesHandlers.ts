import { ipcMain } from 'electron';
import { getDatabase } from '../db';

interface SaleItem {
    product_id: number;
    quantity: number;
    price: number;
}

interface SaleRequest {
    client_id: number | null;
    client_name?: string;
    client_phone?: string;
    items: SaleItem[];
    total_amount: number;
    discount: number;
    final_amount: number;
    payment_usd: number;
    payment_lbp: number;
    change_given_usd?: number;
    change_given_lbp?: number;
    exchange_rate: number;
    id?: number;
    status?: 'completed' | 'draft' | 'cancelled';
    note?: string;
}

export function registerSalesHandlers(): void {
    const db = getDatabase();

    ipcMain.handle('sales:process', (_event, sale: SaleRequest) => {
        try {
            // Use a transaction for data integrity
            const processTransaction = db.transaction(() => {
                let finalClientId = sale.client_id;
                const status = sale.status || 'completed';

                // 0. Auto-create client if name provided but no ID
                if (!finalClientId && sale.client_name) {
                    try {
                        const createClient = db.prepare(`
                            INSERT INTO clients (full_name, phone_number, whatsapp_opt_in)
                            VALUES (?, ?, 0)
                        `);
                        // Use provided phone or NULL
                        const clientResult = createClient.run(sale.client_name, sale.client_phone || null);
                        finalClientId = clientResult.lastInsertRowid as number;
                    } catch (e) {
                        console.error('Auto-create client failed', e);
                    }
                }

                let saleId = sale.id;

                if (saleId) {
                    // UPDATE Existing (e.g., Draft -> Complete or Draft -> Draft Update)
                    const updateStmt = db.prepare(`
                        UPDATE sales SET 
                            client_id = ?, total_amount_usd = ?, discount_usd = ?, final_amount_usd = ?, 
                            paid_usd = ?, paid_lbp = ?, change_given_usd = ?, change_given_lbp = ?, 
                            exchange_rate_snapshot = ?, status = ?, note = ?
                        WHERE id = ?
                    `);
                    updateStmt.run(
                        finalClientId,
                        sale.total_amount,
                        sale.discount,
                        sale.final_amount,
                        sale.payment_usd,
                        sale.payment_lbp,
                        sale.change_given_usd || 0,
                        sale.change_given_lbp || 0,
                        sale.exchange_rate,
                        status,
                        sale.note || null,
                        saleId
                    );

                    // Clear old items to re-insert new ones (simple approach for drafts)
                    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
                } else {
                    // INSERT New
                    const saleStmt = db.prepare(`
                        INSERT INTO sales (
                            client_id, total_amount_usd, discount_usd, final_amount_usd, 
                            paid_usd, paid_lbp, change_given_usd, change_given_lbp, exchange_rate_snapshot,
                            status, note
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    const saleResult = saleStmt.run(
                        finalClientId,
                        sale.total_amount,
                        sale.discount,
                        sale.final_amount,
                        sale.payment_usd,
                        sale.payment_lbp,
                        sale.change_given_usd || 0,
                        sale.change_given_lbp || 0,
                        sale.exchange_rate,
                        status,
                        sale.note || null
                    );
                    saleId = saleResult.lastInsertRowid as number;
                }

                // 2. Process Items & Update Stock
                const itemStmt = db.prepare(`
                    INSERT INTO sale_items (
                        sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd
                    ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ?))
                `);

                const stockStmt = db.prepare(`
                    UPDATE products 
                    SET stock_quantity = stock_quantity - ? 
                    WHERE id = ?
                `);

                for (const item of sale.items) {
                    // Insert Line Item
                    itemStmt.run(
                        saleId,
                        item.product_id,
                        item.quantity,
                        item.price,
                        item.product_id
                    );

                    // Update Stock: ONLY IF COMPLETED
                    if (status === 'completed') {
                        stockStmt.run(item.quantity, item.product_id);
                    }
                }

                // 3. Handle Debt (If Partial Payment AND Completed)
                if (status === 'completed') {
                    const totalPaidUSD = sale.payment_usd + (sale.payment_lbp / sale.exchange_rate);
                    if (sale.final_amount - totalPaidUSD > 0.05) {
                        if (!finalClientId) {
                            throw new Error('Cannot create debt for anonymous client');
                        }
                        const debtAmount = sale.final_amount - totalPaidUSD;

                        const debtStmt = db.prepare(`
                            INSERT INTO debt_ledger (
                                client_id, transaction_type, amount_usd, sale_id, note
                            ) VALUES (?, 'Sale Debt', ?, ?, 'Balance from Sale')
                        `);
                        debtStmt.run(finalClientId, debtAmount, saleId);
                    }
                }

                return { success: true, saleId };
            });

            return processTransaction();

        } catch (error: any) {
            console.error('Sale transaction failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Get Drafts
    ipcMain.handle('sales:get-drafts', () => {
        try {
            const drafts = db.prepare(`
                SELECT s.*, c.full_name as client_name 
                FROM sales s 
                LEFT JOIN clients c ON s.client_id = c.id
                WHERE s.status = 'draft'
                ORDER BY s.created_at DESC
            `).all();

            // Fetch items for each draft (this could be optimized with JSON_GROUP_ARRAY if needed, but simple loop is fine for few drafts)
            const draftsWithItems = drafts.map((draft: any) => {
                const items = db.prepare(`
                    SELECT si.*, p.name, p.barcode 
                    FROM sale_items si
                    JOIN products p ON si.product_id = p.id
                    WHERE si.sale_id = ?
                `).all(draft.id);

                return { ...draft, items };
            });

            return draftsWithItems;
        } catch (error) {
            console.error('Failed to get drafts', error);
            return [];
        }
    });

    // Dashboard Stats
    ipcMain.handle('sales:get-dashboard-stats', () => {
        try {
            // Get today's date in local timezone (YYYY-MM-DD)
            const today = new Date().toISOString().split('T')[0];

            // 1. Total Sales Today (USD) - includes completed sales + repayments
            const salesResult = db.prepare(`
                SELECT SUM(paid_usd + (paid_lbp / exchange_rate_snapshot)) as total 
                FROM sales 
                WHERE DATE(created_at) = ? AND status = 'completed'
            `).get(today) as { total: number };

            // 2. Total Repayments Today
            const repaymentResult = db.prepare(`
                SELECT SUM(ABS(amount_usd)) as total
                FROM debt_ledger
                WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'
            `).get(today) as { total: number };

            const totalSalesWithRepayments = (salesResult.total || 0) + (repaymentResult.total || 0);

            // 3. Orders Count Today
            const ordersResult = db.prepare(`
                SELECT COUNT(*) as count 
                FROM sales 
                WHERE DATE(created_at) = ? AND status = 'completed'
            `).get(today) as { count: number };

            // 4. Active Clients Count
            const clientsResult = db.prepare(`
                SELECT COUNT(*) as count FROM clients
            `).get() as { count: number };

            // 5. Low Stock Items Count
            const stockResult = db.prepare(`
                SELECT COUNT(*) as count 
                FROM products 
                WHERE stock_quantity <= min_stock_level AND is_active = 1
            `).get() as { count: number };

            console.log(`[SALES] Dashboard stats - Today: ${today}, Sales: $${salesResult.total}, Repayments: $${repaymentResult.total}, Total: $${totalSalesWithRepayments}`);

            return {
                totalSales: totalSalesWithRepayments,
                ordersCount: ordersResult.count || 0,
                activeClients: clientsResult.count || 0,
                lowStockCount: stockResult.count || 0
            };
        } catch (error) {
            console.error('Failed to get dashboard stats:', error);
            return {
                totalSales: 0,
                ordersCount: 0,
                activeClients: 0,
                lowStockCount: 0
            };
        }
    });

    // Get Sales Chart Data (Last 7 Days)
    ipcMain.handle('sales:get-sales-chart', () => {
        const stmt = db.prepare(`
            WITH RECURSIVE dates(date) AS (
                VALUES(date('now', 'localtime', '-6 days'))
                UNION ALL
                SELECT date(date, '+1 day')
                FROM dates
                WHERE date < date('now', 'localtime')
            )
            SELECT 
                dates.date,
                COALESCE(SUM(s.final_amount_usd), 0) as amount
            FROM dates
            LEFT JOIN sales s ON date(s.created_at, 'localtime') = dates.date 
                              AND lower(s.status) = 'completed'
            GROUP BY dates.date
            ORDER BY dates.date ASC
        `);
        return stmt.all();
    });

    // Get Recent Activity
    ipcMain.handle('sales:get-recent-activity', () => {
        const stmt = db.prepare(`
            SELECT 
                s.id,
                c.full_name as client_name,
                s.final_amount_usd,
                s.status,
                s.created_at
            FROM sales s
            LEFT JOIN clients c ON s.client_id = c.id
            WHERE s.status = 'completed'
            ORDER BY s.created_at DESC
            LIMIT 5
        `);
        return stmt.all();
    });

    // Get Top Products
    ipcMain.handle('sales:get-top-products', () => {
        const stmt = db.prepare(`
            SELECT 
                p.name,
                COALESCE(SUM(si.quantity), 0) as total_quantity,
                COALESCE(SUM(si.sold_price_usd * si.quantity), 0) as total_revenue
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id
            WHERE s.status = 'completed'
            GROUP BY p.id
            ORDER BY total_quantity DESC
            LIMIT 5
        `);
        return stmt.all();
    });
}

import { ipcMain } from 'electron';
import { getDatabase } from '../db';
import { z } from 'zod';

export function registerDatabaseHandlers(): void {
    const db = getDatabase();

    // Helper function to get all settings
    const _getSettings = () => {
        return db.prepare('SELECT * FROM system_settings').all();
    };

    // Helper function to update a setting
    const _updateSetting = (key: string, value: string) => {
        const stmt = db.prepare(`
          INSERT INTO system_settings (key_name, value)
          VALUES (?, ?)
          ON CONFLICT(key_name)
          DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(key, value, value);
        return { success: true };
    };

    // Get system settings
    ipcMain.handle('db:get-settings', () => {
        return _getSettings();
    });

    // Set Opening balances (upsert into daily_closings)
    ipcMain.handle('closing:set-opening-balances', (_event, data: any) => {
        try {
            const schema = z.object({
                closing_date: z.string().min(8),
                user_id: z.number().optional(),
                amounts: z.array(z.object({
                    drawer_name: z.string().min(1),
                    currency_code: z.string().min(1),
                    opening_amount: z.number().nonnegative()
                }))
            });
            const parsed = schema.safeParse(data);
            if (!parsed.success) return { success: false, error: 'Invalid payload' };
            const payload = parsed.data;

            // We will use a single closing record per date (drawer_name aggregated in detail table)
            const exists = db.prepare(`SELECT id FROM daily_closings WHERE closing_date = ? AND drawer_name = 'AGGREGATED'`).get(payload.closing_date) as { id?: number } | undefined;
            if (exists && exists.id) {
                // Upsert amounts
                const up = db.prepare(`INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
                    VALUES (?, ?, ?, ?, 0)
                    ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET opening_amount=excluded.opening_amount`);
                const tx = db.transaction((rows: typeof payload.amounts) => {
                    for (const r of rows) up.run(exists.id, r.drawer_name, r.currency_code, r.opening_amount);
                });
                tx(payload.amounts);
                // Audit
                db.prepare(`INSERT INTO activity_logs (user_id, action, details_json, created_at) VALUES (?, 'OPENING', ?, CURRENT_TIMESTAMP)`).run(
                    payload.user_id || 1,
                    JSON.stringify({ opening: payload.amounts })
                );
                return { success: true, id: exists.id };
            } else {
                const stmt = db.prepare(`
                    INSERT INTO daily_closings (
                        closing_date, drawer_name, opening_balance_usd, opening_balance_lbp, physical_eur, notes
                    ) VALUES (?, 'AGGREGATED', 0, 0, 0, 'Opening set')
                `);
                const res = stmt.run(
                    payload.closing_date
                );
                const up = db.prepare(`INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
                    VALUES (?, ?, ?, ?, 0)
                    ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET opening_amount=excluded.opening_amount`);
                const tx = db.transaction((rows: typeof payload.amounts) => {
                    for (const r of rows) up.run(res.lastInsertRowid, r.drawer_name, r.currency_code, r.opening_amount);
                });
                tx(payload.amounts);
                db.prepare(`INSERT INTO activity_logs (user_id, action, details_json, created_at) VALUES (?, 'OPENING', ?, CURRENT_TIMESTAMP)`).run(
                    payload.user_id || 1,
                    JSON.stringify({ opening: payload.amounts })
                );
                return { success: true, id: res.lastInsertRowid };
            }
        } catch (error: any) {
            console.error('Failed to set opening balances:', error);
            return { success: false, error: error.message };
        }
    });
    // Alias for settings:get-all
    ipcMain.handle('settings:get-all', (_event) => _getSettings());

    // Get setting by key
    ipcMain.handle('db:get-setting', (_event, key: string) => {
        const setting = db.prepare('SELECT value FROM system_settings WHERE key_name = ?').get(key);
        return setting;
    });

    // Update setting
    ipcMain.handle('db:update-setting', (_event, key: string, value: string) => {
        return _updateSetting(key, value);
    });
    // Alias for settings:update
    ipcMain.handle('settings:update', (_event, key: string, value: string) => _updateSetting(key, value));
    // Add Expense
    ipcMain.handle('db:add-expense', (_event, data: { description: string; category: string; expense_type: string; amount_usd: number; amount_lbp: number; expense_date: string }) => {
        try {
            const db = getDatabase();
            const stmt = db.prepare(`
                INSERT INTO expenses (description, category, expense_type, amount_usd, amount_lbp, expense_date)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(data.description, data.category, data.expense_type, data.amount_usd, data.amount_lbp, data.expense_date);
            
            // Log to activity logs
            const logStmt = db.prepare(`
                INSERT INTO activity_logs (user_id, action, details_json, created_at)
                VALUES (1, 'Add Expense', ?, CURRENT_TIMESTAMP)
            `);
            logStmt.run(JSON.stringify({ category: data.category, amount_usd: data.amount_usd }));
            
            console.log(`[EXPENSE] Added: ${data.category} - $${data.amount_usd}`);
            return { success: true, id: result.lastInsertRowid };
        } catch (error: any) {
            console.error('Failed to add expense:', error);
            return { success: false, error: error.message };
        }
    });

    // Get Today's Expenses
    ipcMain.handle('db:get-today-expenses', () => {
        try {
            const db = getDatabase();
            const expenses = db.prepare(`
                SELECT * FROM expenses 
                WHERE DATE(expense_date) = DATE('now')
                ORDER BY expense_date DESC
            `).all();
            return expenses;
        } catch (error) {
            console.error('Failed to get expenses:', error);
            return [];
        }
    });

    // Delete Expense
    ipcMain.handle('db:delete-expense', (_event, id: number) => {
        try {
            const db = getDatabase();
            
            // Get expense details for logging
            const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
            
            const stmt = db.prepare('DELETE FROM expenses WHERE id = ?');
            stmt.run(id);
            
            // Log to activity logs
            const logStmt = db.prepare(`
                INSERT INTO activity_logs (user_id, action, details_json, created_at)
                VALUES (1, 'Delete Expense', ?, CURRENT_TIMESTAMP)
            `);
            logStmt.run(JSON.stringify({ category: expense.category, amount_usd: expense.amount_usd }));
            
            console.log(`[EXPENSE] Deleted: ${expense.category}`);
            return { success: true };
        } catch (error: any) {
            console.error('Failed to delete expense:', error);
            return { success: false, error: error.message };
        }
    });

    // New IPC handler for fetching system expected balances for closing
    ipcMain.handle('closing:get-system-expected-balances', async () => {
        try {
            const db = getDatabase();
            const today = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

            // Sales (USD & LBP)
            const salesResult = db.prepare(`
                SELECT 
                    SUM(paid_usd) as total_usd_sales,
                    SUM(paid_lbp) as total_lbp_sales
                FROM sales 
                WHERE DATE(created_at) = ? AND status = 'completed'
            `).get(today) as { total_usd_sales: number; total_lbp_sales: number };

            // Debt Repayments (USD & LBP) - these are inflows
            const repaymentsResult = db.prepare(`
                SELECT 
                    SUM(ABS(amount_usd)) as total_usd_repayments,
                    SUM(ABS(amount_lbp)) as total_lbp_repayments
                FROM debt_ledger
                WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'
            `).get(today) as { total_usd_repayments: number; total_lbp_repayments: number };

            // Expenses (USD & LBP) - these are outflows
            const expensesResult = db.prepare(`
                SELECT 
                    SUM(amount_usd) as total_usd_expenses,
                    SUM(amount_lbp) as total_lbp_expenses
                FROM expenses 
                WHERE DATE(expense_date) = ?
            `).get(today) as { total_usd_expenses: number; total_lbp_expenses: number };

            // Calculate net balance for General Drawer B
            const expectedUsd = (salesResult.total_usd_sales || 0) + (repaymentsResult.total_usd_repayments || 0) - (expensesResult.total_usd_expenses || 0);
            const expectedLbp = (salesResult.total_lbp_sales || 0) + (repaymentsResult.total_lbp_repayments || 0) - (expensesResult.total_lbp_expenses || 0);

            // OMT Drawer A expected balances based on financial_services
            const omtInflows = db.prepare(`
                SELECT 
                    COALESCE(SUM(amount_usd), 0) as total_usd,
                    COALESCE(SUM(amount_lbp), 0) as total_lbp
                FROM financial_services
                WHERE DATE(created_at) = ? AND provider = 'OMT' AND service_type = 'RECEIVE'
            `).get(today) as { total_usd: number; total_lbp: number };

            const omtOutflows = db.prepare(`
                SELECT 
                    COALESCE(SUM(amount_usd), 0) as total_usd,
                    COALESCE(SUM(amount_lbp), 0) as total_lbp
                FROM financial_services
                WHERE DATE(created_at) = ? AND provider = 'OMT' AND service_type = 'SEND'
            `).get(today) as { total_usd: number; total_lbp: number };

            const expectedOmtUsd = (omtInflows?.total_usd || 0) - (omtOutflows?.total_usd || 0);
            const expectedOmtLbp = (omtInflows?.total_lbp || 0) - (omtOutflows?.total_lbp || 0);

            return {
                generalDrawer: {
                    usd: expectedUsd,
                    lbp: expectedLbp,
                    eur: 0 // EUR not tracked in these transactions yet
                },
                omtDrawer: {
                    usd: expectedOmtUsd,
                    lbp: expectedOmtLbp,
                    eur: 0
                }
            };
        } catch (error: any) {
            console.error('Failed to get system expected balances:', error);
            return {
                generalDrawer: { usd: 0, lbp: 0, eur: 0 },
                omtDrawer: { usd: 0, lbp: 0, eur: 0 }
            };
        }
    });

    // New IPC handler for creating a daily closing record
    ipcMain.handle('closing:create-daily-closing', (_event, data: any) => {
        try {
            const db = getDatabase();
            const schema = z.object({
                closing_date: z.string().min(8),
                user_id: z.number().optional(),
                variance_notes: z.string().optional(),
                report_path: z.string().optional(),
                system_expected_usd: z.number().optional(),
                system_expected_lbp: z.number().optional(),
                amounts: z.array(z.object({
                    drawer_name: z.string().min(1),
                    currency_code: z.string().min(1),
                    physical_amount: z.number().nonnegative(),
                    opening_amount: z.number().nonnegative().optional()
                }))
            });
            const parsed = schema.safeParse(data);
            if (!parsed.success) return { success: false, error: 'Invalid payload' };
            const payload = parsed.data;

            const stmt = db.prepare(`
                INSERT INTO daily_closings (
                    closing_date, drawer_name, opening_balance_usd, opening_balance_lbp,
                    physical_usd, physical_lbp, physical_eur, system_expected_usd,
                    system_expected_lbp, variance_usd, notes
                ) VALUES (?, 'AGGREGATED', 0, 0, 0, 0, 0, ?, ?, 0, ?)
            `);
            const result = stmt.run(
                payload.closing_date,
                payload.system_expected_usd || 0,
                payload.system_expected_lbp || 0,
                payload.variance_notes || null
            );

            // Insert per-drawer/currency amounts
            const up = db.prepare(`INSERT INTO daily_closing_amounts (closing_id, drawer_name, currency_code, opening_amount, physical_amount)
                VALUES (?, ?, ?, COALESCE(?,0), COALESCE(?,0))
                ON CONFLICT(closing_id, drawer_name, currency_code) DO UPDATE SET physical_amount=excluded.physical_amount, opening_amount=COALESCE(daily_closing_amounts.opening_amount, excluded.opening_amount)`);
            const tx = db.transaction((rows: typeof payload.amounts) => {
                for (const r of rows) up.run(result.lastInsertRowid, r.drawer_name, r.currency_code, r.opening_amount, r.physical_amount);
            });
            tx(payload.amounts);

            // Log to activity logs
            const logStmt = db.prepare(`
                INSERT INTO activity_logs (user_id, action, table_name, record_id, details_json, created_at)
                VALUES (1, 'CREATE_DAILY_CLOSING', 'daily_closings', ?, ?, CURRENT_TIMESTAMP)
            `);
            logStmt.run(result.lastInsertRowid, JSON.stringify({ amounts: payload.amounts }));

            console.log(`[CLOSING] Daily closing created for ${payload.closing_date}`);
            return { success: true, id: result.lastInsertRowid };
        } catch (error: any) {
            console.error('Failed to create daily closing:', error);
            return { success: false, error: error.message };
        }
    });

    // Diagnostics: list sync_errors
    ipcMain.handle('diagnostics:get-sync-errors', () => {
        try {
            const db = getDatabase();
            const rows = db.prepare('SELECT id, endpoint, error, created_at FROM sync_errors ORDER BY id DESC LIMIT 200').all();
            return rows;
        } catch (e: any) {
            return { error: e.message };
        }
    });

    // Update existing daily closing (sets updated_by and updated_at)
    ipcMain.handle('closing:update-daily-closing', (_event, data: {
        id: number;
        physical_usd?: number;
        physical_lbp?: number;
        physical_eur?: number;
        system_expected_usd?: number;
        system_expected_lbp?: number;
        variance_usd?: number;
        notes?: string;
        report_path?: string;
        user_id?: number;
    }) => {
        try {
            const db = getDatabase();
            const current = db.prepare('SELECT * FROM daily_closings WHERE id = ?').get(data.id);
            if (!current) return { success: false, error: 'Not found' };
            const stmt = db.prepare(`UPDATE daily_closings SET
                physical_usd = COALESCE(?, physical_usd),
                physical_lbp = COALESCE(?, physical_lbp),
                physical_eur = COALESCE(?, physical_eur),
                system_expected_usd = COALESCE(?, system_expected_usd),
                system_expected_lbp = COALESCE(?, system_expected_lbp),
                variance_usd = COALESCE(?, variance_usd),
                notes = COALESCE(?, notes),
                report_path = COALESCE(?, report_path),
                updated_by = ?,
                updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`);
            stmt.run(
                data.physical_usd,
                data.physical_lbp,
                data.physical_eur,
                data.system_expected_usd,
                data.system_expected_lbp,
                data.variance_usd,
                data.notes,
                data.report_path,
                data.user_id || 1,
                data.id
            );
            return { success: true };
        } catch (error: any) {
            console.error('Failed to update daily closing:', error);
            return { success: false, error: error.message };
        }
    });

    // New IPC handler for fetching daily stats snapshot for the closing report
    ipcMain.handle('closing:get-daily-stats-snapshot', async () => {
        try {
            const db = getDatabase();
            const today = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

            // 1. Sales Count and Total Sales
            const salesStats = db.prepare(`
                SELECT
                    COUNT(id) as sales_count,
                    SUM(final_amount_usd) as total_sales_usd,
                    SUM(paid_lbp) as total_sales_lbp -- Assuming paid_lbp reflects LBP sales amount
                FROM sales
                WHERE DATE(created_at) = ? AND status = 'completed'
            `).get(today) as { sales_count: number; total_sales_usd: number; total_sales_lbp: number };

            // 2. Debt Payments (Repayments)
            const debtPayments = db.prepare(`
                SELECT
                    SUM(ABS(amount_usd)) as total_debt_payments_usd,
                    SUM(ABS(amount_lbp)) as total_debt_payments_lbp
                FROM debt_ledger
                WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'
            `).get(today) as { total_debt_payments_usd: number; total_debt_payments_lbp: number };

            // 3. Expenses
            const expensesStats = db.prepare(`
                SELECT
                    SUM(amount_usd) as total_expenses_usd,
                    SUM(amount_lbp) as total_expenses_lbp
                FROM expenses
                WHERE DATE(expense_date) = ?
            `).get(today) as { total_expenses_usd: number; total_expenses_lbp: number };

            // 4. Profit
            const profitStats = db.prepare(`
                SELECT
                    SUM(si.sold_price_usd - si.cost_price_snapshot_usd) as total_profit_usd
                FROM sales s
                JOIN sale_items si ON s.id = si.sale_id
                WHERE DATE(s.created_at) = ? AND s.status = 'completed'
                      AND (s.paid_usd + (s.paid_lbp / s.exchange_rate_snapshot)) >= s.final_amount_usd -- Only consider fully paid sales for profit
            `).get(today) as { total_profit_usd: number };

            return {
                salesCount: salesStats.sales_count || 0,
                totalSalesUSD: salesStats.total_sales_usd || 0,
                totalSalesLBP: salesStats.total_sales_lbp || 0,
                debtPaymentsUSD: debtPayments.total_debt_payments_usd || 0,
                debtPaymentsLBP: debtPayments.total_debt_payments_lbp || 0,
                totalExpensesUSD: expensesStats.total_expenses_usd || 0,
                totalExpensesLBP: expensesStats.total_expenses_lbp || 0,
                totalProfitUSD: profitStats.total_profit_usd || 0,
            };
        } catch (error: any) {
            console.error('Failed to get daily stats snapshot:', error);
            return {
                salesCount: 0,
                totalSalesUSD: 0,
                totalSalesLBP: 0,
                debtPaymentsUSD: 0,
                debtPaymentsLBP: 0,
                totalExpensesUSD: 0,
                totalExpensesLBP: 0,
                totalProfitUSD: 0,
            };
        }
    });
}

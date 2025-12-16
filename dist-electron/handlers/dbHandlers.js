"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDatabaseHandlers = registerDatabaseHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerDatabaseHandlers() {
    const db = (0, db_1.getDatabase)();
    // Helper function to get all settings
    const _getSettings = () => {
        return db.prepare('SELECT * FROM system_settings').all();
    };
    // Helper function to update a setting
    const _updateSetting = (key, value) => {
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
    electron_1.ipcMain.handle('db:get-settings', () => {
        return _getSettings();
    });
    // Alias for settings:get-all
    electron_1.ipcMain.handle('settings:get-all', (_event) => _getSettings());
    // Get setting by key
    electron_1.ipcMain.handle('db:get-setting', (_event, key) => {
        const setting = db.prepare('SELECT value FROM system_settings WHERE key_name = ?').get(key);
        return setting;
    });
    // Update setting
    electron_1.ipcMain.handle('db:update-setting', (_event, key, value) => {
        return _updateSetting(key, value);
    });
    // Alias for settings:update
    electron_1.ipcMain.handle('settings:update', (_event, key, value) => _updateSetting(key, value));
    // Add Expense
    electron_1.ipcMain.handle('db:add-expense', (_event, data) => {
        try {
            const db = (0, db_1.getDatabase)();
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
        }
        catch (error) {
            console.error('Failed to add expense:', error);
            return { success: false, error: error.message };
        }
    });
    // Get Today's Expenses
    electron_1.ipcMain.handle('db:get-today-expenses', () => {
        try {
            const db = (0, db_1.getDatabase)();
            const expenses = db.prepare(`
                SELECT * FROM expenses 
                WHERE DATE(expense_date) = DATE('now')
                ORDER BY expense_date DESC
            `).all();
            return expenses;
        }
        catch (error) {
            console.error('Failed to get expenses:', error);
            return [];
        }
    });
    // Delete Expense
    electron_1.ipcMain.handle('db:delete-expense', (_event, id) => {
        try {
            const db = (0, db_1.getDatabase)();
            // Get expense details for logging
            const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
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
        }
        catch (error) {
            console.error('Failed to delete expense:', error);
            return { success: false, error: error.message };
        }
    });
    // New IPC handler for fetching system expected balances for closing
    electron_1.ipcMain.handle('closing:get-system-expected-balances', async () => {
        try {
            const db = (0, db_1.getDatabase)();
            const today = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
            // Sales (USD & LBP)
            const salesResult = db.prepare(`
                SELECT 
                    SUM(paid_usd) as total_usd_sales,
                    SUM(paid_lbp) as total_lbp_sales
                FROM sales 
                WHERE DATE(created_at) = ? AND status = 'completed'
            `).get(today);
            // Debt Repayments (USD & LBP) - these are inflows
            const repaymentsResult = db.prepare(`
                SELECT 
                    SUM(ABS(amount_usd)) as total_usd_repayments,
                    SUM(ABS(amount_lbp)) as total_lbp_repayments
                FROM debt_ledger
                WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'
            `).get(today);
            // Expenses (USD & LBP) - these are outflows
            const expensesResult = db.prepare(`
                SELECT 
                    SUM(amount_usd) as total_usd_expenses,
                    SUM(amount_lbp) as total_lbp_expenses
                FROM expenses 
                WHERE DATE(expense_date) = ?
            `).get(today);
            // Calculate net balance for General Drawer B
            const expectedUsd = (salesResult.total_usd_sales || 0) + (repaymentsResult.total_usd_repayments || 0) - (expensesResult.total_usd_expenses || 0);
            const expectedLbp = (salesResult.total_lbp_sales || 0) + (repaymentsResult.total_lbp_repayments || 0) - (expensesResult.total_lbp_expenses || 0);
            // Placeholder for OMT Drawer A - for now, just return 0, implementation will be in omtHandlers.ts
            const expectedOmtUsd = 0;
            const expectedOmtLbp = 0;
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
        }
        catch (error) {
            console.error('Failed to get system expected balances:', error);
            return {
                generalDrawer: { usd: 0, lbp: 0, eur: 0 },
                omtDrawer: { usd: 0, lbp: 0, eur: 0 }
            };
        }
    });
    // New IPC handler for creating a daily closing record
    electron_1.ipcMain.handle('closing:create-daily-closing', (_event, data) => {
        try {
            const db = (0, db_1.getDatabase)();
            const stmt = db.prepare(`
                INSERT INTO daily_closings (
                    closing_date, drawer_name, opening_balance_usd, opening_balance_lbp,
                    physical_usd, physical_lbp, physical_eur, system_expected_usd,
                    system_expected_lbp, variance_usd, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(data.closing_date, data.drawer_name, data.opening_balance_usd, data.opening_balance_lbp, data.physical_usd, data.physical_lbp, data.physical_eur, data.system_expected_usd, data.system_expected_lbp, data.variance_usd, data.notes || null);
            // Log to activity logs
            const logStmt = db.prepare(`
                INSERT INTO activity_logs (user_id, action, table_name, record_id, details_json, created_at)
                VALUES (1, 'CREATE_DAILY_CLOSING', 'daily_closings', ?, ?, CURRENT_TIMESTAMP)
            `);
            logStmt.run(result.lastInsertRowid, JSON.stringify(data));
            console.log(`[CLOSING] Daily closing created for ${data.closing_date} - ${data.drawer_name}`);
            return { success: true, id: result.lastInsertRowid };
        }
        catch (error) {
            console.error('Failed to create daily closing:', error);
            return { success: false, error: error.message };
        }
    });
    // New IPC handler for fetching daily stats snapshot for the closing report
    electron_1.ipcMain.handle('closing:get-daily-stats-snapshot', async () => {
        try {
            const db = (0, db_1.getDatabase)();
            const today = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
            // 1. Sales Count and Total Sales
            const salesStats = db.prepare(`
                SELECT
                    COUNT(id) as sales_count,
                    SUM(final_amount_usd) as total_sales_usd,
                    SUM(paid_lbp) as total_sales_lbp -- Assuming paid_lbp reflects LBP sales amount
                FROM sales
                WHERE DATE(created_at) = ? AND status = 'completed'
            `).get(today);
            // 2. Debt Payments (Repayments)
            const debtPayments = db.prepare(`
                SELECT
                    SUM(ABS(amount_usd)) as total_debt_payments_usd,
                    SUM(ABS(amount_lbp)) as total_debt_payments_lbp
                FROM debt_ledger
                WHERE DATE(created_at) = ? AND transaction_type = 'Repayment'
            `).get(today);
            // 3. Expenses
            const expensesStats = db.prepare(`
                SELECT
                    SUM(amount_usd) as total_expenses_usd,
                    SUM(amount_lbp) as total_expenses_lbp
                FROM expenses
                WHERE DATE(expense_date) = ?
            `).get(today);
            // 4. Profit
            const profitStats = db.prepare(`
                SELECT
                    SUM(si.sold_price_usd - si.cost_price_snapshot_usd) as total_profit_usd
                FROM sales s
                JOIN sale_items si ON s.id = si.sale_id
                WHERE DATE(s.created_at) = ? AND s.status = 'completed'
                      AND (s.paid_usd + (s.paid_lbp / s.exchange_rate_snapshot)) >= s.final_amount_usd -- Only consider fully paid sales for profit
            `).get(today);
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
        }
        catch (error) {
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

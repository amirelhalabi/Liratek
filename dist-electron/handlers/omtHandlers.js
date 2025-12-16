"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOMTHandlers = registerOMTHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerOMTHandlers() {
    const db = (0, db_1.getDatabase)();
    // Add Transaction (Drawer A for OMT, Drawer B for WHISH/BOB/OTHER)
    electron_1.ipcMain.handle('omt:add-transaction', (_event, data) => {
        try {
            const stmt = db.prepare(`
                INSERT INTO financial_services (
                    provider, service_type, amount_usd, amount_lbp, 
                    commission_usd, commission_lbp, client_name, reference_number, note
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(data.provider, data.serviceType, data.amountUSD || 0, data.amountLBP || 0, data.commissionUSD || 0, data.commissionLBP || 0, data.clientName || null, data.referenceNumber || null, data.note || null);
            // Determine which drawer this affects
            const drawer = data.provider === 'OMT' ? 'OMT_Drawer_A' : 'General_Drawer_B';
            // Log to activity logs
            const logStmt = db.prepare(`
                INSERT INTO activity_logs (user_id, action, details, created_at)
                VALUES (1, 'Financial Service Transaction', ?, CURRENT_TIMESTAMP)
            `);
            logStmt.run(JSON.stringify({
                drawer,
                provider: data.provider,
                serviceType: data.serviceType,
                commission_usd: data.commissionUSD,
                commission_lbp: data.commissionLBP
            }));
            console.log(`[OMT/WHISH] ${data.provider} - ${data.serviceType}: Commission $${data.commissionUSD} [${drawer}]`);
            return { success: true, id: result.lastInsertRowid };
        }
        catch (error) {
            console.error('Failed to add financial service transaction:', error);
            return { success: false, error: error.message };
        }
    });
    // Get History (Last 50 transactions)
    electron_1.ipcMain.handle('omt:get-history', (_event, provider) => {
        try {
            let query = `SELECT * FROM financial_services`;
            const params = [];
            if (provider) {
                query += ` WHERE provider = ?`;
                params.push(provider);
            }
            query += ` ORDER BY created_at DESC LIMIT 50`;
            const transactions = db.prepare(query).all(...params);
            return transactions;
        }
        catch (error) {
            console.error('Failed to get financial services history:', error);
            return [];
        }
    });
    // Get Analytics (Today & Month totals)
    electron_1.ipcMain.handle('omt:get-analytics', () => {
        try {
            // Today's commission
            const todayStats = db.prepare(`
                SELECT 
                    COALESCE(SUM(commission_usd), 0) as today_commission_usd,
                    COALESCE(SUM(commission_lbp), 0) as today_commission_lbp,
                    COUNT(*) as today_count
                FROM financial_services 
                WHERE DATE(created_at) = DATE('now', 'localtime')
            `).get();
            // This month's commission
            const monthStats = db.prepare(`
                SELECT 
                    COALESCE(SUM(commission_usd), 0) as month_commission_usd,
                    COALESCE(SUM(commission_lbp), 0) as month_commission_lbp,
                    COUNT(*) as month_count
                FROM financial_services 
                WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
            `).get();
            // By Provider Today
            const byProvider = db.prepare(`
                SELECT 
                    provider,
                    COALESCE(SUM(commission_usd), 0) as commission_usd,
                    COALESCE(SUM(commission_lbp), 0) as commission_lbp,
                    COUNT(*) as count
                FROM financial_services 
                WHERE DATE(created_at) = DATE('now', 'localtime')
                GROUP BY provider
            `).all();
            return {
                today: {
                    commissionUSD: todayStats.today_commission_usd,
                    commissionLBP: todayStats.today_commission_lbp,
                    count: todayStats.today_count
                },
                month: {
                    commissionUSD: monthStats.month_commission_usd,
                    commissionLBP: monthStats.month_commission_lbp,
                    count: monthStats.month_count
                },
                byProvider
            };
        }
        catch (error) {
            console.error('Failed to get analytics:', error);
            return {
                today: { commissionUSD: 0, commissionLBP: 0, count: 0 },
                month: { commissionUSD: 0, commissionLBP: 0, count: 0 },
                byProvider: []
            };
        }
    });
}

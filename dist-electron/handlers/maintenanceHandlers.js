"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMaintenanceHandlers = registerMaintenanceHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerMaintenanceHandlers() {
    const db = (0, db_1.getDatabase)();
    // Add / Update Maintenance Job
    electron_1.ipcMain.handle('maintenance:save', (_event, job) => {
        try {
            const processTransaction = db.transaction(() => {
                // 1. Handle Client (Auto-create if name provided but no ID)
                let finalClientId = job.client_id;
                if (!finalClientId && job.client_name) {
                    try {
                        // Check if exists first to avoid duplicates if logic fails elsewhere
                        const existing = db.prepare('SELECT id FROM clients WHERE full_name = ?').get(job.client_name);
                        if (existing) {
                            finalClientId = existing.id;
                        }
                        else {
                            const createClient = db.prepare(`
                                INSERT INTO clients (full_name, phone_number, whatsapp_opt_in)
                                VALUES (?, ?, 0)
                            `);
                            const clientResult = createClient.run(job.client_name, job.client_phone || null);
                            finalClientId = clientResult.lastInsertRowid;
                        }
                    }
                    catch (e) {
                        console.error('Auto-create client failed', e);
                    }
                }
                if (job.id) {
                    // Update
                    const stmt = db.prepare(`
                        UPDATE maintenance SET 
                            client_id = ?, client_name = ?, device_name = ?, issue_description = ?,
                            cost_usd = ?, price_usd = ?, discount_usd = ?, final_amount_usd = ?,
                            paid_usd = ?, paid_lbp = ?, exchange_rate = ?, status = ?, note = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `);
                    stmt.run(finalClientId, job.client_name, job.device_name, job.issue_description, job.cost_usd, job.price_usd, job.discount_usd, job.final_amount_usd, job.paid_usd, job.paid_lbp, job.exchange_rate, job.status, job.note, job.id);
                    return { success: true, id: job.id };
                }
                else {
                    // Insert
                    const stmt = db.prepare(`
                        INSERT INTO maintenance (
                            client_id, client_name, device_name, issue_description,
                            cost_usd, price_usd, discount_usd, final_amount_usd,
                            paid_usd, paid_lbp, exchange_rate, status, note
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    const res = stmt.run(finalClientId, job.client_name, job.device_name, job.issue_description, job.cost_usd, job.price_usd, job.discount_usd, job.final_amount_usd, job.paid_usd, job.paid_lbp, job.exchange_rate, job.status, job.note);
                    return { success: true, id: res.lastInsertRowid };
                }
            });
            return processTransaction();
        }
        catch (error) {
            console.error('Maintenance save error:', error);
            return { success: false, error: error.message };
        }
    });
    // Get Jobs
    electron_1.ipcMain.handle('maintenance:get-jobs', (_event, statusFilter) => {
        try {
            let query = `SELECT * FROM maintenance`;
            const params = [];
            if (statusFilter && statusFilter !== 'All') {
                query += ` WHERE status = ?`;
                params.push(statusFilter);
            }
            query += ` ORDER BY created_at DESC`;
            return db.prepare(query).all(...params);
        }
        catch (error) {
            console.error('Get maintenance jobs error:', error);
            return [];
        }
    });
    // Delete / Cancel
    electron_1.ipcMain.handle('maintenance:delete', (_event, id) => {
        try {
            db.prepare('DELETE FROM maintenance WHERE id = ?').run(id);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    });
}

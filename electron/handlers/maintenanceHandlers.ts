import { ipcMain } from 'electron';
import { getDatabase } from '../db';

export function registerMaintenanceHandlers(): void {
    const db = getDatabase();

    // Add / Update Maintenance Job (Drawer B - General Drawer)
    ipcMain.handle('maintenance:save', (_event, job: any) => {
        try {
            const processTransaction = db.transaction(() => {
                // 1. Handle Client (Auto-create if name provided but no ID)
                let finalClientId = job.client_id;
                if (!finalClientId && job.client_name) {
                    try {
                        // Check if exists first to avoid duplicates if logic fails elsewhere
                        const existing = db.prepare('SELECT id FROM clients WHERE full_name = ?').get(job.client_name) as any;
                        if (existing) {
                            finalClientId = existing.id;
                        } else {
                            const createClient = db.prepare(`
                                INSERT INTO clients (full_name, phone_number, whatsapp_opt_in)
                                VALUES (?, ?, 0)
                            `);
                            const clientResult = createClient.run(job.client_name, job.client_phone || null);
                            finalClientId = clientResult.lastInsertRowid as number;
                        }
                    } catch (e) {
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
                    stmt.run(
                        finalClientId, job.client_name, job.device_name, job.issue_description,
                        job.cost_usd, job.price_usd, job.discount_usd, job.final_amount_usd,
                        job.paid_usd, job.paid_lbp, job.exchange_rate, job.status, job.note,
                        job.id
                    );

                    // Log status change
                    if (job.status === 'Delivered_Paid' || job.status === 'Delivered') {
                        const logStmt = db.prepare(`
                            INSERT INTO activity_logs (user_id, action, details, created_at)
                            VALUES (1, 'Maintenance Job Completed', ?, CURRENT_TIMESTAMP)
                        `);
                        logStmt.run(JSON.stringify({
                            drawer: 'General_Drawer_B',
                            device: job.device_name,
                            amount_usd: job.final_amount_usd,
                            status: job.status
                        }));
                        console.log(`[MAINTENANCE] Job ${job.id} completed: ${job.device_name} - $${job.final_amount_usd} [Drawer B]`);
                    }
                    return { success: true, id: job.id };
                } else {
                    // Insert
                    const stmt = db.prepare(`
                        INSERT INTO maintenance (
                            client_id, client_name, device_name, issue_description,
                            cost_usd, price_usd, discount_usd, final_amount_usd,
                            paid_usd, paid_lbp, exchange_rate, status, note
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    const res = stmt.run(
                        finalClientId, job.client_name, job.device_name, job.issue_description,
                        job.cost_usd, job.price_usd, job.discount_usd, job.final_amount_usd,
                        job.paid_usd, job.paid_lbp, job.exchange_rate, job.status, job.note
                    );

                    // Log new job
                    const logStmt = db.prepare(`
                        INSERT INTO activity_logs (user_id, action, details, created_at)
                        VALUES (1, 'Maintenance Job Created', ?, CURRENT_TIMESTAMP)
                    `);
                    logStmt.run(JSON.stringify({
                        drawer: 'General_Drawer_B',
                        device: job.device_name,
                        price_usd: job.price_usd
                    }));
                    console.log(`[MAINTENANCE] New job: ${job.device_name} - $${job.price_usd} [Drawer B]`);
                    return { success: true, id: res.lastInsertRowid };
                }
            });

            return processTransaction();
        } catch (error: any) {
            console.error('Maintenance save error:', error);
            return { success: false, error: error.message };
        }
    });

    // Get Jobs
    ipcMain.handle('maintenance:get-jobs', (_event, statusFilter?: string) => {
        try {
            let query = `SELECT * FROM maintenance`;
            const params = [];
            
            if (statusFilter && statusFilter !== 'All') {
                query += ` WHERE status = ?`;
                params.push(statusFilter);
            }
            
            query += ` ORDER BY created_at DESC`;
            
            return db.prepare(query).all(...params);
        } catch (error) {
            console.error('Get maintenance jobs error:', error);
            return [];
        }
    });
    
    // Delete / Cancel
    ipcMain.handle('maintenance:delete', (_event, id: number) => {
         try {
             db.prepare('DELETE FROM maintenance WHERE id = ?').run(id);
             return { success: true };
         } catch (error: any) {
             return { success: false, error: error.message };
         }
    });
}

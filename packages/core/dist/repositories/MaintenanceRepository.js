import { BaseRepository } from "./BaseRepository.js";
export class MaintenanceRepository extends BaseRepository {
    constructor() {
        super("maintenance");
    }
    /**
     * Create a new maintenance job
     */
    createJob(job) {
        const stmt = this.db.prepare(`
      INSERT INTO maintenance (
        client_id, client_name, device_name, issue_description,
        cost_usd, price_usd, discount_usd, final_amount_usd,
        paid_usd, paid_lbp, exchange_rate, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(job.client_id ?? null, job.client_name ?? null, job.device_name, job.issue_description ?? null, job.cost_usd ?? 0, job.price_usd ?? 0, job.discount_usd ?? 0, job.final_amount_usd ?? 0, job.paid_usd ?? 0, job.paid_lbp ?? 0, job.exchange_rate ?? 0, job.status ?? "In Progress", job.note ?? null);
        return Number(result.lastInsertRowid);
    }
    /**
     * Update an existing maintenance job
     */
    updateJob(id, job) {
        const stmt = this.db.prepare(`
      UPDATE maintenance SET 
        client_id = ?, client_name = ?, device_name = ?, issue_description = ?,
        cost_usd = ?, price_usd = ?, discount_usd = ?, final_amount_usd = ?,
        paid_usd = ?, paid_lbp = ?, exchange_rate = ?, status = ?, note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
        stmt.run(job.client_id ?? null, job.client_name ?? null, job.device_name, job.issue_description ?? null, job.cost_usd ?? 0, job.price_usd ?? 0, job.discount_usd ?? 0, job.final_amount_usd ?? 0, job.paid_usd ?? 0, job.paid_lbp ?? 0, job.exchange_rate ?? 0, job.status ?? "In Progress", job.note ?? null, id);
    }
    /**
     * Get jobs by status filter
     */
    getJobs(statusFilter) {
        if (statusFilter && statusFilter !== "All") {
            const stmt = this.db.prepare(`SELECT * FROM maintenance WHERE status = ? ORDER BY created_at DESC`);
            return stmt.all(statusFilter);
        }
        const stmt = this.db.prepare(`SELECT * FROM maintenance ORDER BY created_at DESC`);
        return stmt.all();
    }
    /**
     * Delete a job by ID
     */
    deleteJob(id) {
        this.db.prepare("DELETE FROM maintenance WHERE id = ?").run(id);
    }
    /**
     * Log activity for a maintenance job
     */
    logActivity(userId, action, details) {
        this.db
            .prepare(`INSERT INTO activity_logs (user_id, action, details_json, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
            .run(userId, action, JSON.stringify(details));
    }
    /**
     * Find or create a client by name
     */
    findOrCreateClient(name, phone) {
        const existing = this.db
            .prepare(`SELECT id FROM clients WHERE full_name = ?`)
            .get(name);
        if (existing)
            return existing.id;
        const result = this.db
            .prepare(`INSERT INTO clients (full_name, phone_number, whatsapp_opt_in) VALUES (?, ?, 0)`)
            .run(name, phone ?? null);
        return Number(result.lastInsertRowid);
    }
    /**
     * Execute a function within a transaction
     */
    withTransaction(fn) {
        return this.db.transaction(fn)();
    }
}

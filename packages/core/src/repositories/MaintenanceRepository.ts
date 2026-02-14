import { BaseRepository } from "./BaseRepository.js";

export interface MaintenanceJob {
  id?: number;
  client_id?: number | null;
  client_name?: string | null;
  device_name: string;
  issue_description?: string | null;
  cost_usd?: number;
  price_usd?: number;
  discount_usd?: number;
  final_amount_usd?: number;
  paid_usd?: number;
  paid_lbp?: number;
  exchange_rate?: number;
  status?: string;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface MaintenanceRow {
  id: number;
  client_id: number | null;
  client_name: string | null;
  device_name: string;
  issue_description: string | null;
  cost_usd: number;
  price_usd: number;
  discount_usd: number;
  final_amount_usd: number;
  paid_usd: number;
  paid_lbp: number;
  exchange_rate: number;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export class MaintenanceRepository extends BaseRepository<MaintenanceRow> {
  constructor() {
    super("maintenance");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, client_name, device_name, issue_description, cost_usd, price_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, exchange_rate, status, note, created_at, updated_at";
  }

  /**
   * Create a new maintenance job
   */
  createJob(job: MaintenanceJob): number {
    const stmt = this.db.prepare(`
      INSERT INTO maintenance (
        client_id, client_name, device_name, issue_description,
        cost_usd, price_usd, discount_usd, final_amount_usd,
        paid_usd, paid_lbp, exchange_rate, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      job.client_id ?? null,
      job.client_name ?? null,
      job.device_name,
      job.issue_description ?? null,
      job.cost_usd ?? 0,
      job.price_usd ?? 0,
      job.discount_usd ?? 0,
      job.final_amount_usd ?? 0,
      job.paid_usd ?? 0,
      job.paid_lbp ?? 0,
      job.exchange_rate ?? 0,
      job.status ?? "In Progress",
      job.note ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Update an existing maintenance job
   */
  updateJob(id: number, job: MaintenanceJob): void {
    const stmt = this.db.prepare(`
      UPDATE maintenance SET 
        client_id = ?, client_name = ?, device_name = ?, issue_description = ?,
        cost_usd = ?, price_usd = ?, discount_usd = ?, final_amount_usd = ?,
        paid_usd = ?, paid_lbp = ?, exchange_rate = ?, status = ?, note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(
      job.client_id ?? null,
      job.client_name ?? null,
      job.device_name,
      job.issue_description ?? null,
      job.cost_usd ?? 0,
      job.price_usd ?? 0,
      job.discount_usd ?? 0,
      job.final_amount_usd ?? 0,
      job.paid_usd ?? 0,
      job.paid_lbp ?? 0,
      job.exchange_rate ?? 0,
      job.status ?? "In Progress",
      job.note ?? null,
      id,
    );
  }

  /**
   * Get jobs by status filter
   */
  getJobs(statusFilter?: string): MaintenanceRow[] {
    if (statusFilter && statusFilter !== "All") {
      const stmt = this.db.prepare(
        `SELECT ${this.getColumns()} FROM maintenance WHERE status = ? ORDER BY created_at DESC`,
      );
      return stmt.all(statusFilter) as MaintenanceRow[];
    }
    const stmt = this.db.prepare(
      `SELECT ${this.getColumns()} FROM maintenance ORDER BY created_at DESC`,
    );
    return stmt.all() as MaintenanceRow[];
  }

  /**
   * Delete a job by ID
   */
  deleteJob(id: number): void {
    this.db.prepare("DELETE FROM maintenance WHERE id = ?").run(id);
  }

  /**
   * Log activity for a maintenance job
   */
  logActivity(
    userId: number,
    action: string,
    details: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO activity_logs (user_id, action, details_json, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(userId, action, JSON.stringify(details));
  }

  /**
   * Find or create a client by name
   */
  findOrCreateClient(name: string, phone?: string | null): number {
    const existing = this.db
      .prepare(`SELECT id FROM clients WHERE full_name = ?`)
      .get(name) as { id: number } | undefined;

    if (existing) return existing.id;

    const result = this.db
      .prepare(
        `INSERT INTO clients (full_name, phone_number, whatsapp_opt_in) VALUES (?, ?, 0)`,
      )
      .run(name, phone ?? null);
    return Number(result.lastInsertRowid);
  }

  /**
   * Execute a function within a transaction
   */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

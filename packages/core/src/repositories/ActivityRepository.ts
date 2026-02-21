import { BaseRepository } from "./BaseRepository.js";

export interface ActivityLogEntity {
  id: number;
  user_id: number;
  username?: string;
  action: string;
  table_name?: string | null;
  record_id?: number | null;
  details_json?: string | null;
  customer_name?: string | null;
  created_at?: string;
}

export interface SyncErrorEntity {
  id: number;
  endpoint: string;
  error: string;
  created_at?: string;
}

export class ActivityRepository extends BaseRepository<ActivityLogEntity> {
  constructor() {
    super("activity_logs");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, user_id, action, table_name, record_id, details_json, created_at";
  }

  /**
   * Get recent activity logs with username and customer name
   */
  getRecentLogs(limit: number = 200): ActivityLogEntity[] {
    const n = Math.min(Math.max(Number(limit), 1), 1000);
    return this.db
      .prepare(
        `SELECT
           a.id, a.user_id, u.username, a.action, a.table_name, a.record_id,
           a.details_json, a.created_at,
           COALESCE(c.full_name, fc.full_name) AS customer_name
         FROM activity_logs a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN sales s ON a.table_name = 'sales' AND s.id = a.record_id
         LEFT JOIN clients c ON c.id = s.client_id
         LEFT JOIN financial_services fs ON a.table_name = 'financial_services' AND fs.id = a.record_id
         LEFT JOIN clients fc ON fc.id = fs.client_id
         ORDER BY a.id DESC LIMIT ?`,
      )
      .all(n) as ActivityLogEntity[];
  }

  /**
   * Log an activity
   */
  logActivity(
    userId: number,
    action: string,
    details?: Record<string, unknown>,
    tableName?: string,
    recordId?: number,
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO activity_logs (user_id, action, table_name, record_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      userId,
      action,
      tableName || null,
      recordId || null,
      details ? JSON.stringify(details) : null,
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Get sync errors for diagnostics
   */
  getSyncErrors(limit: number = 200): SyncErrorEntity[] {
    return this.db
      .prepare(
        `SELECT id, endpoint, error, created_at 
         FROM sync_errors ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as SyncErrorEntity[];
  }
}

// Singleton instance
let activityRepositoryInstance: ActivityRepository | null = null;

export function getActivityRepository(): ActivityRepository {
  if (!activityRepositoryInstance) {
    activityRepositoryInstance = new ActivityRepository();
  }
  return activityRepositoryInstance;
}

export function resetActivityRepository(): void {
  activityRepositoryInstance = null;
}

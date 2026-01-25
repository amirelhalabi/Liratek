import { BaseRepository } from "./BaseRepository.js";

export interface ActivityLogEntity {
  id: number;
  user_id: number;
  action: string;
  table_name?: string | null;
  record_id?: number | null;
  details_json?: string | null;
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

  /**
   * Get recent activity logs
   */
  getRecentLogs(limit: number = 200): ActivityLogEntity[] {
    const n = Math.min(Math.max(Number(limit), 1), 1000);
    return this.db
      .prepare(
        `SELECT id, user_id, action, table_name, record_id, details_json, created_at 
         FROM activity_logs ORDER BY id DESC LIMIT ?`,
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

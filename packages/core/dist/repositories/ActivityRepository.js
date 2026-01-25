import { BaseRepository } from "./BaseRepository.js";
export class ActivityRepository extends BaseRepository {
    constructor() {
        super("activity_logs");
    }
    /**
     * Get recent activity logs
     */
    getRecentLogs(limit = 200) {
        const n = Math.min(Math.max(Number(limit), 1), 1000);
        return this.db
            .prepare(`SELECT id, user_id, action, table_name, record_id, details_json, created_at 
         FROM activity_logs ORDER BY id DESC LIMIT ?`)
            .all(n);
    }
    /**
     * Log an activity
     */
    logActivity(userId, action, details, tableName, recordId) {
        const stmt = this.db.prepare(`
      INSERT INTO activity_logs (user_id, action, table_name, record_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        const result = stmt.run(userId, action, tableName || null, recordId || null, details ? JSON.stringify(details) : null);
        return Number(result.lastInsertRowid);
    }
    /**
     * Get sync errors for diagnostics
     */
    getSyncErrors(limit = 200) {
        return this.db
            .prepare(`SELECT id, endpoint, error, created_at 
         FROM sync_errors ORDER BY id DESC LIMIT ?`)
            .all(limit);
    }
}
// Singleton instance
let activityRepositoryInstance = null;
export function getActivityRepository() {
    if (!activityRepositoryInstance) {
        activityRepositoryInstance = new ActivityRepository();
    }
    return activityRepositoryInstance;
}
export function resetActivityRepository() {
    activityRepositoryInstance = null;
}

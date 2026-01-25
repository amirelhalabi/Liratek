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
export declare class ActivityRepository extends BaseRepository<ActivityLogEntity> {
    constructor();
    /**
     * Get recent activity logs
     */
    getRecentLogs(limit?: number): ActivityLogEntity[];
    /**
     * Log an activity
     */
    logActivity(userId: number, action: string, details?: Record<string, unknown>, tableName?: string, recordId?: number): number;
    /**
     * Get sync errors for diagnostics
     */
    getSyncErrors(limit?: number): SyncErrorEntity[];
}
export declare function getActivityRepository(): ActivityRepository;
export declare function resetActivityRepository(): void;

import { ActivityLogEntity, SyncErrorEntity } from "../repositories/ActivityRepository.js";
export declare class ActivityService {
    private repo;
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
    getSyncErrors(limit?: number): SyncErrorEntity[] | {
        error: string;
    };
}
export declare function getActivityService(): ActivityService;
export declare function resetActivityService(): void;

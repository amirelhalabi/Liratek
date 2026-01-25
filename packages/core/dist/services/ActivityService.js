import { getActivityRepository, } from "../repositories/ActivityRepository.js";
export class ActivityService {
    repo;
    constructor() {
        this.repo = getActivityRepository();
    }
    /**
     * Get recent activity logs
     */
    getRecentLogs(limit) {
        try {
            return this.repo.getRecentLogs(limit);
        }
        catch (error) {
            console.error("ActivityService.getRecentLogs error:", error);
            return [];
        }
    }
    /**
     * Log an activity
     */
    logActivity(userId, action, details, tableName, recordId) {
        try {
            return this.repo.logActivity(userId, action, details, tableName, recordId);
        }
        catch (error) {
            console.error("ActivityService.logActivity error:", error);
            return 0;
        }
    }
    /**
     * Get sync errors for diagnostics
     */
    getSyncErrors(limit) {
        try {
            return this.repo.getSyncErrors(limit);
        }
        catch (error) {
            console.error("ActivityService.getSyncErrors error:", error);
            return { error: error instanceof Error ? error.message : String(error) };
        }
    }
}
// Singleton instance
let activityServiceInstance = null;
export function getActivityService() {
    if (!activityServiceInstance) {
        activityServiceInstance = new ActivityService();
    }
    return activityServiceInstance;
}
export function resetActivityService() {
    activityServiceInstance = null;
}

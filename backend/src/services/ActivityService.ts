import {
  ActivityRepository,
  ActivityLogEntity,
  SyncErrorEntity,
  getActivityRepository,
} from "../database/repositories/ActivityRepository";

export class ActivityService {
  private repo: ActivityRepository;

  constructor() {
    this.repo = getActivityRepository();
  }

  /**
   * Get recent activity logs
   */
  getRecentLogs(limit?: number): ActivityLogEntity[] {
    try {
      return this.repo.getRecentLogs(limit);
    } catch (error) {
      console.error("ActivityService.getRecentLogs error:", error);
      return [];
    }
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
    try {
      return this.repo.logActivity(
        userId,
        action,
        details,
        tableName,
        recordId,
      );
    } catch (error) {
      console.error("ActivityService.logActivity error:", error);
      return 0;
    }
  }

  /**
   * Get sync errors for diagnostics
   */
  getSyncErrors(limit?: number): SyncErrorEntity[] | { error: string } {
    try {
      return this.repo.getSyncErrors(limit);
    } catch (error) {
      console.error("ActivityService.getSyncErrors error:", error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

// Singleton instance
let activityServiceInstance: ActivityService | null = null;

export function getActivityService(): ActivityService {
  if (!activityServiceInstance) {
    activityServiceInstance = new ActivityService();
  }
  return activityServiceInstance;
}

export function resetActivityService(): void {
  activityServiceInstance = null;
}

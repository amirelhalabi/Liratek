import {
  ActivityRepository,
  ActivityLogEntity,
  SyncErrorEntity,
  getActivityRepository,
} from "../repositories/ActivityRepository.js";
import logger from "../utils/logger.js";

export class ActivityService {
  private repo: ActivityRepository;

  constructor(repo?: ActivityRepository) {
    this.repo = repo ?? getActivityRepository();
  }

  /**
   * Get recent activity logs
   */
  getRecentLogs(limit?: number): ActivityLogEntity[] {
    try {
      return this.repo.getRecentLogs(limit);
    } catch (error) {
      logger.error({ error }, "ActivityService.getRecentLogs error");
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
      logger.error({ error }, "ActivityService.logActivity error");
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
      logger.error({ error }, "ActivityService.getSyncErrors error");
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

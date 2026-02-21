import {
  getTransactionService,
  type TransactionService,
} from "./TransactionService.js";
import { getDatabase } from "../db/connection.js";
import logger from "../utils/logger.js";

/** @deprecated Use TransactionService.getRecent() directly */
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

/**
 * @deprecated Prefer TransactionService directly.
 * Kept for backward-compat with IPC handlers that still call getRecentLogs / getSyncErrors.
 */
export class ActivityService {
  private txnService: TransactionService;
  private dbGetter: () => import("better-sqlite3").Database;

  constructor(
    txnService?: TransactionService,
    dbGetter?: () => import("better-sqlite3").Database,
  ) {
    this.txnService = txnService ?? getTransactionService();
    this.dbGetter = dbGetter ?? getDatabase;
  }

  /**
   * Get recent activity logs — delegates to TransactionService
   */
  getRecentLogs(limit?: number): ActivityLogEntity[] {
    try {
      const rows = this.txnService.getRecent(limit);
      return rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        username: r.username ?? undefined,
        action: r.type,
        table_name: r.source_table,
        record_id: r.source_id,
        details_json:
          typeof r.metadata_json === "string"
            ? r.metadata_json
            : r.metadata_json
              ? JSON.stringify(r.metadata_json)
              : null,
        customer_name: r.client_name ?? undefined,
        created_at: r.created_at,
      }));
    } catch (error) {
      logger.error({ error }, "ActivityService.getRecentLogs error");
      return [];
    }
  }

  /**
   * Get sync errors for diagnostics (queries sync_errors table directly)
   */
  getSyncErrors(limit?: number): SyncErrorEntity[] | { error: string } {
    try {
      const db = this.dbGetter();
      const n = Math.min(Math.max(Number(limit ?? 200), 1), 1000);
      return db
        .prepare(
          `SELECT id, endpoint, error, created_at
           FROM sync_errors ORDER BY id DESC LIMIT ?`,
        )
        .all(n) as SyncErrorEntity[];
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

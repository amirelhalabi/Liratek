import { logger } from "@liratek/core";
import { getGoogleSheetsService } from "./GoogleSheetsService.js";
import { getSubscriptionCache } from "./SubscriptionCacheService.js";

class SubscriptionSyncService {
  private syncIntervalMs: number;
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;

  constructor(syncIntervalHours: number = 12) {
    this.syncIntervalMs = syncIntervalHours * 60 * 60 * 1000;
    logger.info({ syncIntervalHours }, "Subscription sync service initialized");
  }

  /**
   * Start automatic sync
   */
  start(): void {
    if (this.syncTimer) {
      logger.warn("Sync already running");
      return;
    }

    logger.info(
      { intervalHours: Math.round(this.syncIntervalMs / (1000 * 60 * 60)) },
      "Starting automatic subscription sync",
    );

    // Initial sync
    this.syncFromSheets().catch((err) => {
      logger.error({ error: err.message }, "Initial sync failed");
    });

    // Schedule regular syncs
    this.syncTimer = setInterval(() => {
      this.syncFromSheets().catch((err) => {
        logger.error({ error: err.message }, "Scheduled sync failed");
      });
    }, this.syncIntervalMs);
  }

  /**
   * Stop automatic sync
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      logger.info("Stopped automatic subscription sync");
    }
  }

  /**
   * Manual sync trigger
   */
  async syncFromSheets(): Promise<{ synced: number; failed: number }> {
    if (this.isSyncing) {
      logger.warn("Sync already in progress");
      return { synced: 0, failed: 0 };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      logger.info("Starting subscription data sync from Google Sheets");

      const sheets = getGoogleSheetsService();
      const cache = getSubscriptionCache();

      // Fetch all clients from sheets
      const clients = await sheets.getAllClients();

      let synced = 0;
      let failed = 0;

      // Update cache for each client
      for (const client of clients) {
        try {
          cache.set(client.shop_name, client);
          synced++;
        } catch (error: any) {
          logger.error(
            { shopName: client.shop_name, error: error.message },
            "Failed to cache client",
          );
          failed++;
        }
      }

      const duration = Date.now() - startTime;
      logger.info(
        { synced, failed, duration: Math.round(duration) },
        "Subscription sync completed",
      );

      return { synced, failed };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error(
        { error: error.message, duration: Math.round(duration) },
        "Subscription sync failed",
      );
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get sync status
   */
  getStatus(): {
    isSyncing: boolean;
    isRunning: boolean;
    intervalHours: number;
    cacheSize: number;
  } {
    const cache = getSubscriptionCache();
    const stats = cache.getStats();

    return {
      isSyncing: this.isSyncing,
      isRunning: this.syncTimer !== null,
      intervalHours: Math.round(this.syncIntervalMs / (1000 * 60 * 60)),
      cacheSize: stats.size,
    };
  }
}

// Singleton instance
let instance: SubscriptionSyncService | null = null;

/**
 * Get or create sync service instance
 */
export function getSubscriptionSyncService(): SubscriptionSyncService {
  if (!instance) {
    const syncIntervalHours = parseInt(process.env.CACHE_TTL_HOURS || "12", 10);
    instance = new SubscriptionSyncService(syncIntervalHours);
  }

  return instance;
}

export default SubscriptionSyncService;

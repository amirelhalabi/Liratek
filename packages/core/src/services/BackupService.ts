/**
 * Backup Service
 * Creates and manages database backups
 */

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

export interface BackupInfo {
  path: string;
  timestamp: string;
  size: number;
  source: string;
}

export interface BackupResult {
  success: boolean;
  path?: string;
  error?: string;
  info?: BackupInfo;
}

export class BackupService {
  private backupDir: string;

  constructor(backupDir: string) {
    this.backupDir = backupDir;
  }

  /**
   * Create a backup of the database file
   * Each PC backs up to its own Documents/Liratek/Backups folder
   */
  createBackup(dbPath: string): BackupResult {
    try {
      // Validate database file exists
      if (!fs.existsSync(dbPath)) {
        return {
          success: false,
          error: `Database file not found: ${dbPath}`,
        };
      }

      // Ensure backup directory exists
      fs.mkdirSync(this.backupDir, { recursive: true });

      // Generate backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dbFileName = path.basename(dbPath, ".db");
      const backupFileName = `${dbFileName}-backup-${timestamp}.db`;
      const backupPath = path.join(this.backupDir, backupFileName);

      // Copy database file
      fs.copyFileSync(dbPath, backupPath);

      // Also backup WAL and SHM files if they exist (for WAL mode)
      const walPath = dbPath + "-wal";
      const shmPath = dbPath + "-shm";

      if (fs.existsSync(walPath)) {
        fs.copyFileSync(walPath, backupPath + "-wal");
      }
      if (fs.existsSync(shmPath)) {
        fs.copyFileSync(shmPath, backupPath + "-shm");
      }

      // Get file size
      const stats = fs.statSync(backupPath);

      const backupInfo: BackupInfo = {
        path: backupPath,
        timestamp: new Date().toISOString(),
        size: stats.size,
        source: dbPath,
      };

      logger.info(
        { backupPath, size: stats.size, source: dbPath },
        "Database backup created successfully",
      );

      return {
        success: true,
        path: backupPath,
        info: backupInfo,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg, dbPath }, "Database backup failed");

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get list of existing backups
   */
  listBackups(): BackupInfo[] {
    try {
      if (!fs.existsSync(this.backupDir)) {
        return [];
      }

      const files = fs.readdirSync(this.backupDir);
      const backups: BackupInfo[] = [];

      for (const file of files) {
        if (file.endsWith(".db") && file.includes("-backup-")) {
          const filePath = path.join(this.backupDir, file);
          const stats = fs.statSync(filePath);

          // Extract timestamp from filename
          const match = file.match(/-backup-(.+)\.db/);
          const timestamp = match
            ? match[1]
                .replace(/-/g, ":")
                .replace(/(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
            : "Unknown";

          backups.push({
            path: filePath,
            timestamp: new Date(timestamp).toISOString(),
            size: stats.size,
            source: "Unknown",
          });
        }
      }

      // Sort by timestamp (newest first)
      return backups.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    } catch (error) {
      logger.error({ error }, "Failed to list backups");
      return [];
    }
  }

  /**
   * Delete old backups (keep only last N backups)
   */
  cleanupOldBackups(keepCount: number = 24): void {
    try {
      const backups = this.listBackups();

      if (backups.length <= keepCount) {
        return;
      }

      // Delete oldest backups beyond keepCount
      const toDelete = backups.slice(keepCount);

      for (const backup of toDelete) {
        try {
          fs.unlinkSync(backup.path);

          // Also delete WAL and SHM files if they exist
          if (fs.existsSync(backup.path + "-wal")) {
            fs.unlinkSync(backup.path + "-wal");
          }
          if (fs.existsSync(backup.path + "-shm")) {
            fs.unlinkSync(backup.path + "-shm");
          }

          logger.info({ path: backup.path }, "Old backup deleted");
        } catch (error) {
          logger.warn(
            { error, path: backup.path },
            "Failed to delete old backup",
          );
        }
      }

      logger.info(
        { deleted: toDelete.length, kept: keepCount },
        "Backup cleanup completed",
      );
    } catch (error) {
      logger.error({ error }, "Backup cleanup failed");
    }
  }

  /**
   * Get backup directory path
   */
  getBackupDir(): string {
    return this.backupDir;
  }
}

// Singleton instance
let instance: BackupService | null = null;

export function getBackupService(backupDir?: string): BackupService {
  if (!instance) {
    if (!backupDir) {
      throw new Error(
        "BackupService not initialized. Provide backupDir on first call.",
      );
    }
    instance = new BackupService(backupDir);
  }
  return instance;
}

export function resetBackupService(): void {
  instance = null;
}

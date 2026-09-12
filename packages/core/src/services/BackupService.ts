/**
 * Backup Service
 * Creates and manages database backups
 */

import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import {
  BackupRepository,
  getBackupRepository,
} from "../repositories/BackupRepository.js";

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

/**
 * Recover the ISO timestamp from a backup filename, falling back to the file's
 * mtime when the name does not parse.
 *
 * createBackup() builds the name as `toISOString()` with `:` and `.` both
 * replaced by `-`, giving `2026-09-09T09-13-29-906Z`. The previous reverse of
 * that replaced EVERY `-` with `:` and then repaired only the date, leaving
 * `2026-09-09T09:13:29:906Z` — the milliseconds separator is a colon, which is
 * not a valid date. `new Date()` returned Invalid Date and `.toISOString()`
 * threw RangeError, which listBackups()'s catch turned into an empty array.
 *
 * So every backup this service ever wrote was invisible to the UI that lists
 * them: you could take a backup and never see or restore it. Same shape of bug
 * as the settings read that returned [] on failure — a catch that converts
 * "broken" into a legitimate-looking "nothing here".
 *
 * The fallback exists so ONE oddly-named file can never blank the whole list
 * again.
 */
function parseBackupTimestamp(fileName: string, mtime: Date): string {
  const match = fileName.match(
    /-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/,
  );
  if (match) {
    const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return mtime.toISOString();
}

export class BackupService {
  private backupDir: string;
  private repo: BackupRepository;

  constructor(
    backupDir: string,
    repo: BackupRepository = getBackupRepository(),
  ) {
    this.backupDir = backupDir;
    this.repo = repo;
  }

  /**
   * Create a backup of the database.
   * Each PC backs up to its own Documents/Liratek/Backups folder.
   *
   * Takes a CONSISTENT snapshot via `VACUUM INTO` (see BackupRepository for
   * why). This used to copy the `.db`, `-wal` and `-shm` files one after
   * another with no lock, which can capture pieces from either side of a
   * checkpoint and produce a backup that is missing committed transactions or
   * will not open — silently, because the copies themselves always succeed.
   *
   * The snapshot is a single self-contained file, so there are no `-wal` /
   * `-shm` siblings to write, keep in sync, or restore alongside it.
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

      // One statement, one point in time. SQLite refuses to overwrite an
      // existing destination, which the timestamped name already avoids.
      this.repo.snapshotTo(backupPath);

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

          backups.push({
            path: filePath,
            timestamp: parseBackupTimestamp(file, stats.mtime),
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

          // Kept for backups written BEFORE the switch to VACUUM INTO: those
          // have -wal/-shm siblings that would otherwise be left behind
          // forever. New snapshots never produce them.
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

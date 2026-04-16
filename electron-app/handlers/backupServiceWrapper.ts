/**
 * Backup Service Wrapper
 * Local wrapper to avoid core package rebuild issues
 */

import fs from "fs";
import path from "path";

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

  createBackup(dbPath: string): BackupResult {
    try {
      if (!fs.existsSync(dbPath)) {
        return {
          success: false,
          error: `Database file not found: ${dbPath}`,
        };
      }

      fs.mkdirSync(this.backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dbFileName = path.basename(dbPath, ".db");
      const backupFileName = `${dbFileName}-backup-${timestamp}.db`;
      const backupPath = path.join(this.backupDir, backupFileName);

      fs.copyFileSync(dbPath, backupPath);

      const walPath = dbPath + "-wal";
      const shmPath = dbPath + "-shm";

      if (fs.existsSync(walPath)) {
        fs.copyFileSync(walPath, backupPath + "-wal");
      }
      if (fs.existsSync(shmPath)) {
        fs.copyFileSync(shmPath, backupPath + "-shm");
      }

      const stats = fs.statSync(backupPath);

      const backupInfo: BackupInfo = {
        path: backupPath,
        timestamp: new Date().toISOString(),
        size: stats.size,
        source: dbPath,
      };

      return {
        success: true,
        path: backupPath,
        info: backupInfo,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

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

      return backups.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    } catch (error) {
      return [];
    }
  }

  cleanupOldBackups(keepCount: number = 24): void {
    try {
      const backups = this.listBackups();

      if (backups.length <= keepCount) {
        return;
      }

      const toDelete = backups.slice(keepCount);

      for (const backup of toDelete) {
        try {
          fs.unlinkSync(backup.path);

          if (fs.existsSync(backup.path + "-wal")) {
            fs.unlinkSync(backup.path + "-wal");
          }
          if (fs.existsSync(backup.path + "-shm")) {
            fs.unlinkSync(backup.path + "-shm");
          }
        } catch (error) {
          // Ignore delete errors
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  getBackupDir(): string {
    return this.backupDir;
  }
}

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

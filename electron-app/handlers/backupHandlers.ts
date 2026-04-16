/**
 * Backup IPC Handlers
 * Handles database backup operations
 */

import { ipcMain, app } from "electron";
import path from "path";
import fs from "fs";
import { getDatabase, logger } from "@liratek/core";
import { getBackupService } from "./backupServiceWrapper.js";

let backupService: ReturnType<typeof getBackupService> | null = null;

function getBackupServiceInstance(): ReturnType<typeof getBackupService> {
  if (!backupService) {
    // Each PC backs up to its own Documents/Liratek/Backups folder
    const documentsPath = app.getPath("documents");
    const backupDir = path.join(documentsPath, "Liratek", "Backups");
    backupService = getBackupService(backupDir);
  }
  return backupService;
}

// Get database path from main module
function getDbPath(): string {
  const db = getDatabase();
  // Get the actual file path from the database instance
  const stmt = db.prepare(
    "SELECT file FROM pragma_database_list WHERE name = 'main'",
  );
  const result = stmt.get() as { file: string } | undefined;
  return result?.file || "";
}

export function registerBackupHandlers(): void {
  logger.info("Registering backup IPC handlers");

  // ── Create Manual Backup ───────────────────────────────────────────────────
  ipcMain.handle("backup:create", async () => {
    try {
      const db = getDatabase();
      const dbPath = getDbPath();

      if (!dbPath) {
        return {
          success: false,
          error: "Database path not available",
        };
      }

      const service = getBackupServiceInstance();
      const result = service.createBackup(dbPath);

      if (result.success) {
        // Cleanup old backups (keep last 24 = 24 hours of hourly backups)
        service.cleanupOldBackups(24);
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "backup:create failed");
      return {
        success: false,
        error: errorMsg,
      };
    }
  });

  // ── List Backups ───────────────────────────────────────────────────────────
  ipcMain.handle("backup:list", async () => {
    try {
      const service = getBackupServiceInstance();
      const backups = service.listBackups();
      return { success: true, backups };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "backup:list failed");
      return {
        success: false,
        error: errorMsg,
        backups: [],
      };
    }
  });

  // ── Delete Backup ──────────────────────────────────────────────────────────
  ipcMain.handle("backup:delete", async (_event, backupPath: string) => {
    try {
      const fs = await import("fs");

      if (!fs.existsSync(backupPath)) {
        return {
          success: false,
          error: "Backup file not found",
        };
      }

      fs.unlinkSync(backupPath);

      // Also delete WAL and SHM files if they exist
      if (fs.existsSync(backupPath + "-wal")) {
        fs.unlinkSync(backupPath + "-wal");
      }
      if (fs.existsSync(backupPath + "-shm")) {
        fs.unlinkSync(backupPath + "-shm");
      }

      logger.info({ path: backupPath }, "Backup deleted");
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: errorMsg, path: backupPath },
        "backup:delete failed",
      );
      return {
        success: false,
        error: errorMsg,
      };
    }
  });

  // ── Get Backup Directory ───────────────────────────────────────────────────
  ipcMain.handle("backup:getDir", async () => {
    try {
      const service = getBackupServiceInstance();
      return { success: true, path: service.getBackupDir() };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "backup:getDir failed");
      return {
        success: false,
        error: errorMsg,
        path: "",
      };
    }
  });

  logger.info("Backup IPC handlers registered");
}

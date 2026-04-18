/**
 * Backup IPC Handlers
 * Handles database backup operations
 */

import { ipcMain, app, dialog, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { getDatabase, logger, getSettingsService } from "@liratek/core";
import { requireRole } from "../session.js";
import {
  getBackupService,
  resetBackupService,
} from "./backupServiceWrapper.js";

let backupService: ReturnType<typeof getBackupService> | null = null;

function getDefaultBackupDir(): string {
  const documentsPath = app.getPath("documents");
  return path.join(documentsPath, "Liratek", "Backups");
}

function getCustomBackupDir(): string | null {
  try {
    const settingsService = getSettingsService();
    const value = settingsService.getSettingValue("backup_directory");
    if (value && typeof value === "string" && fs.existsSync(value)) {
      return value;
    }
  } catch {
    // Settings not available yet, use default
  }
  return null;
}

function getBackupServiceInstance(): ReturnType<typeof getBackupService> {
  if (!backupService) {
    const backupDir = getCustomBackupDir() || getDefaultBackupDir();
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
  ipcMain.handle("backup:create", async (event) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const db = getDatabase();
      const dbPath = getDbPath();

      if (!dbPath) {
        return {
          success: false,
          error: "Database path not available",
        };
      }

      // Flush WAL into main DB so we only need the single .db file
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // If checkpoint fails, proceed anyway
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
  ipcMain.handle("backup:delete", async (event, backupPath: string) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const fs = await import("fs");

      if (!fs.existsSync(backupPath)) {
        return {
          success: false,
          error: "Backup file not found",
        };
      }

      fs.unlinkSync(backupPath);

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

  // ── Pick Backup Directory (opens native folder dialog) ────────────────────
  ipcMain.handle("backup:pickDir", async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: "Select Backup Directory",
        properties: ["openDirectory", "createDirectory"],
        defaultPath: getCustomBackupDir() || getDefaultBackupDir(),
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      return { success: true, path: result.filePaths[0] };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "backup:pickDir failed");
      return { success: false, error: errorMsg };
    }
  });

  // ── Set Backup Directory ──────────────────────────────────────────────────
  ipcMain.handle("backup:setDir", async (event, newDir: string) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      if (!newDir || typeof newDir !== "string") {
        return { success: false, error: "Invalid directory path" };
      }

      // Create directory if it doesn't exist
      fs.mkdirSync(newDir, { recursive: true });

      // Verify it's writable
      const testFile = path.join(newDir, ".liratek-test");
      fs.writeFileSync(testFile, "test");
      fs.unlinkSync(testFile);

      // Persist to settings
      const settingsService = getSettingsService();
      settingsService.updateSetting("backup_directory", newDir);

      // Reinitialize backup service with new directory
      resetBackupService();
      backupService = null;
      backupService = getBackupService(newDir);

      logger.info({ newDir }, "Backup directory changed");
      return { success: true, path: newDir };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "backup:setDir failed");
      return { success: false, error: errorMsg };
    }
  });

  logger.info("Backup IPC handlers registered");
}

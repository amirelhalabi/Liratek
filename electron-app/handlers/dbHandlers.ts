import { ipcMain, app, dialog } from "electron";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";
import {
  getSettingsService,
  getExpenseService,
  getClosingService,
  getActivityService,
  resolveDatabasePath,
  settingsLogger,
  expenseLogger,
  closingLogger,
  logger,
  getUserRepository,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { AddExpenseSchema, validatePayload } from "../schemas/index.js";

export function registerDatabaseHandlers(): void {
  const settingsService = getSettingsService();
  const expenseService = getExpenseService();
  const activityService = getActivityService();

  // ==================== SETTINGS ====================

  // Get system settings
  ipcMain.handle("db:get-settings", () => {
    return settingsService.getAllSettings();
  });

  // Alias for settings:get-all
  ipcMain.handle("settings:get-all", () => {
    return settingsService.getAllSettings();
  });

  // Get setting by key
  ipcMain.handle("db:get-setting", (_event, key: string) => {
    return settingsService.getSettingValue(key);
  });

  // Update setting
  ipcMain.handle("db:update-setting", (e, key: string, value: string) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    settingsLogger.info({ key }, "Updating setting");
    const result = settingsService.updateSetting(key, value);
    audit(e.sender.id, {
      action: "update",
      entity_type: "setting",
      entity_id: key,
      summary: `Updated setting "${key}"`,
      new_values: { value },
    });
    return result;
  });

  // Alias for settings:update
  ipcMain.handle("settings:update", (e, key: string, value: string) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    const result = settingsService.updateSetting(key, value);
    audit(e.sender.id, {
      action: "update",
      entity_type: "setting",
      entity_id: key,
      summary: `Updated setting "${key}"`,
      new_values: { value },
    });
    return result;
  });

  // ==================== EXPENSES ====================

  // Add Expense
  ipcMain.handle(
    "db:add-expense",
    (
      e,
      data: {
        description: string;
        category: string;
        expense_type: string;
        paid_by_method?: string;
        amount_usd: number;
        amount_lbp: number;
        expense_date: string;
      },
    ) => {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      // Validation
      const v = validatePayload(AddExpenseSchema, data);
      if (!v.ok) return { success: false, error: v.error };
      const validatedData = v.data;

      expenseLogger.info(
        {
          category: validatedData.category,
          amountUSD: validatedData.amount_usd,
        },
        "Adding expense",
      );
      const result = expenseService.addExpense(validatedData, auth.userId);
      audit(e.sender.id, {
        action: "create",
        entity_type: "expense",
        summary: `Added expense: ${validatedData.category} $${validatedData.amount_usd}`,
        metadata: {
          category: validatedData.category,
          amount_usd: validatedData.amount_usd,
        },
      });
      return result;
    },
  );

  // Get Today's Expenses
  ipcMain.handle("db:get-today-expenses", () => {
    return expenseService.getTodayExpenses();
  });

  // Delete Expense
  ipcMain.handle("db:delete-expense", (e, id: number) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const result = expenseService.deleteExpense(id, auth.userId);
    audit(e.sender.id, {
      action: "delete",
      entity_type: "expense",
      entity_id: String(id),
      summary: `Deleted expense #${id}`,
    });
    return result;
  });

  // Update expense metadata (staff and admin)
  ipcMain.handle(
    "expenses:update-metadata",
    (
      e,
      data: {
        id: number;
        description?: string;
        category?: string;
        note?: string;
      },
    ) => {
      const auth = requireRole(e.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      let editedBy = `user-${auth.userId}`;
      try {
        const userRepo = getUserRepository();
        const user = userRepo.findById(auth.userId);
        if (user) editedBy = user.username;
      } catch {
        // fallback to user-{id}
      }

      const result = expenseService.updateExpenseMetadata(
        data.id,
        {
          description: data.description,
          category: data.category,
          note: data.note,
        },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        audit(e.sender.id, {
          action: "edit_metadata",
          entity_type: "expense",
          entity_id: String(data.id),
          summary: `Edited expense #${data.id} metadata`,
          old_values: result.oldValues,
          new_values: data,
        });
      }

      return result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error };
    },
  );

  // ==================== CLOSING ====================

  // Get system expected balances (dynamic format: Record<drawerName, Record<currencyCode, balance>>)
  ipcMain.handle("closing:get-system-expected-balances-dynamic", async () => {
    return getClosingService().getSystemExpectedBalancesDynamic();
  });

  // Get daily stats snapshot
  ipcMain.handle("closing:get-daily-stats-snapshot", async () => {
    return getClosingService().getDailyStatsSnapshot();
  });

  // ==================== ACTIVITY & DIAGNOSTICS ====================

  // Diagnostics: list sync_errors
  ipcMain.handle("diagnostics:get-sync-errors", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { error: "Forbidden" };
    } catch {}
    return activityService.getSyncErrors();
  });

  // Diagnostics: get database file path
  ipcMain.handle("diagnostics:getDbPath", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: "Forbidden" };
    } catch {
      // No session — allow anyway for diagnostics
    }
    try {
      const resolved = resolveDatabasePath();
      return { success: true, path: resolved.path, source: resolved.source };
    } catch (err) {
      settingsLogger.error({ err }, "diagnostics:getDbPath failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  // Recalculate drawer balances from payments journal
  ipcMain.handle("closing:recalculate-drawer-balances", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    closingLogger.info("Recalculating drawer balances from payments journal");
    const result = getClosingService().recalculateDrawerBalances();
    audit(e.sender.id, {
      action: "update",
      entity_type: "drawer_balance",
      summary: "Recalculated drawer balances from payments journal",
    });
    return result;
  });

  // Get checkpoint timeline
  ipcMain.handle(
    "closing:getCheckpointTimeline",
    async (
      _event,
      filters: {
        date?: string;
        type?: "OPENING" | "CLOSING" | "CHECKPOINT" | "ALL";
        drawer_name?: string;
        user_id?: number;
      },
    ) => {
      try {
        const closingService = getClosingService();
        return closingService.getCheckpointTimeline(filters);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Unified checkpoint: create
  ipcMain.handle(
    "closing:create-checkpoint",
    async (
      e,
      data: {
        user_id: number;
        notes?: string;
        report_path?: string;
        amounts: Array<{
          drawer_name: string;
          currency_code: string;
          expected_amount: number;
          physical_amount: number;
        }>;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const closingService = getClosingService();
        const result = closingService.createCheckpoint(data);
        if (result.success) {
          audit(e.sender.id, {
            action: "create_checkpoint",
            entity_type: "daily_closings",
            entity_id: String(result.id ?? ""),
            summary: `Checkpoint created`,
          });
        }
        return result;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Unified checkpoint: get last checkpoint actuals (baseline)
  ipcMain.handle("closing:get-last-checkpoint-actuals", async () => {
    try {
      const closingService = getClosingService();
      return {
        success: true,
        data: closingService.getLastCheckpointActuals(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Check if opening balance exists for today (no auth required — called on login)
  ipcMain.handle("closing:has-opening-balance-today", async () => {
    try {
      return getClosingService().hasOpeningBalanceToday();
    } catch (err) {
      closingLogger.error({ err }, "closing:has-opening-balance-today failed");
      return false;
    }
  });

  // Update an existing daily closing record
  ipcMain.handle(
    "closing:update-daily-closing",
    async (
      e,
      data: {
        id: number;
        physical_usd?: number;
        physical_lbp?: number;
        physical_eur?: number;
        system_expected_usd?: number;
        system_expected_lbp?: number;
        variance_usd?: number;
        notes?: string;
        report_path?: string;
        user_id?: number;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const result = getClosingService().updateDailyClosing(data);
        if (result.success) {
          audit(e.sender.id, {
            action: "update",
            entity_type: "daily_closings",
            entity_id: String(data.id),
            summary: `Updated daily closing #${data.id}`,
          });
        }
        return result;
      } catch (err) {
        closingLogger.error({ err }, "closing:update-daily-closing failed");
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Diagnostics: run PRAGMA foreign_key_check
  ipcMain.handle("diagnostics:foreign-key-check", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    try {
      const { getDatabase } = await import("../db.js");
      const db = getDatabase();
      const rows = db.pragma("foreign_key_check");
      return { success: true, rows };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Recent activity logs
  ipcMain.handle("activity:get-recent", (_e, limit?: number) => {
    return activityService.getRecentLogs(limit);
  });

  // ==================== DATABASE PATH MANAGEMENT ====================

  const DB_PATH_FILE = "db-path.txt";
  const DB_PATH_PREV_FILE = "db-path-prev.txt";
  const configDir = path.join(os.homedir(), "Documents", "LiraTek");

  // Check if this is a join installation (db-path.txt exists)
  ipcMain.handle("database:isJoinInstallation", () => {
    try {
      const configFile = path.join(configDir, DB_PATH_FILE);
      return { success: true, isJoin: fs.existsSync(configFile) };
    } catch (err) {
      logger.error({ err }, "database:isJoinInstallation failed");
      return {
        success: false,
        isJoin: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  // Browse for a database file (reuses native file dialog)
  ipcMain.handle("database:browse", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Select LiraTek Database",
        filters: [{ name: "Database", extensions: ["db", "sqlite"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const selectedPath = result.filePaths[0];
      if (!fs.existsSync(selectedPath)) {
        return { success: false, error: "File does not exist" };
      }

      return { success: true, path: selectedPath };
    } catch (err) {
      logger.error({ err }, "database:browse failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

  // Change the database path: validate, save previous, write new, relaunch
  ipcMain.handle("database:changePath", async (_e, newPath: string) => {
    try {
      if (!newPath || typeof newPath !== "string" || !newPath.trim()) {
        return { success: false, error: "Path is required" };
      }

      const trimmedPath = newPath.trim();

      // Check file exists
      if (!fs.existsSync(trimmedPath)) {
        return { success: false, error: "Database file does not exist" };
      }

      // Read current path to save as previous
      const dbPathFile = path.join(configDir, DB_PATH_FILE);
      const prevPathFile = path.join(configDir, DB_PATH_PREV_FILE);

      fs.mkdirSync(configDir, { recursive: true });

      // Save current path as previous (for rollback)
      const resolved = resolveDatabasePath();
      fs.writeFileSync(prevPathFile, resolved.path, "utf8");

      // Write new path
      fs.writeFileSync(dbPathFile, trimmedPath, "utf8");

      logger.info(
        { oldPath: resolved.path, newPath: trimmedPath },
        "Database path changed, relaunching...",
      );

      // Relaunch after a short delay to let the response reach the renderer
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 500);

      return { success: true };
    } catch (err) {
      logger.error({ err }, "database:changePath failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });
}

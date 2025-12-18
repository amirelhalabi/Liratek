import { ipcMain } from "electron";
import { z } from "zod";
import { SettingsService } from "../services/SettingsService";
import { ExpenseService } from "../services/ExpenseService";
import { ClosingService } from "../services/ClosingService";
import { ActivityService } from "../services/ActivityService";
import { settingsLogger, expenseLogger, closingLogger } from "../utils/logger";

export function registerDatabaseHandlers(): void {
  const settingsService = new SettingsService();
  const expenseService = new ExpenseService();
  const closingService = new ClosingService();
  const activityService = new ActivityService();

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
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    settingsLogger.info({ key }, "Updating setting");
    return settingsService.updateSetting(key, value);
  });

  // Alias for settings:update
  ipcMain.handle("settings:update", (e, key: string, value: string) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    return settingsService.updateSetting(key, value);
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
        amount_usd: number;
        amount_lbp: number;
        expense_date: string;
      }
    ) => {
      try {
        const { requireRole } = require("../session");
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}
      expenseLogger.info({ category: data.category, amountUSD: data.amount_usd }, "Adding expense");
      return expenseService.addExpense(data);
    }
  );

  // Get Today's Expenses
  ipcMain.handle("db:get-today-expenses", () => {
    return expenseService.getTodayExpenses();
  });

  // Delete Expense
  ipcMain.handle("db:delete-expense", (e, id: number) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    return expenseService.deleteExpense(id);
  });

  // ==================== CLOSING ====================

  // Set Opening balances
  ipcMain.handle("closing:set-opening-balances", (e, data: any) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    const schema = z.object({
      closing_date: z.string().min(8),
      user_id: z.number().optional(),
      amounts: z.array(
        z.object({
          drawer_name: z.string().min(1),
          currency_code: z.string().min(1),
          opening_amount: z.number().nonnegative(),
        })
      ),
    });
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { success: false, error: "Invalid payload" };

    closingLogger.info({ date: parsed.data.closing_date }, "Setting opening balances");
    return closingService.setOpeningBalances(parsed.data);
  });

  // Get system expected balances
  ipcMain.handle("closing:get-system-expected-balances", async () => {
    return closingService.getSystemExpectedBalances();
  });

  // Check if opening balance has been set for today
  ipcMain.handle("closing:has-opening-balance-today", async () => {
    try {
      return closingService.hasOpeningBalanceToday();
    } catch (error: any) {
      closingLogger.error({ error: error.message }, "Error checking opening balance");
      return false; // Default to false if error
    }
  });

  // Create daily closing
  ipcMain.handle("closing:create-daily-closing", (e, data: any) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    const schema = z.object({
      closing_date: z.string().min(8),
      user_id: z.number().optional(),
      variance_notes: z.string().optional(),
      report_path: z.string().optional(),
      system_expected_usd: z.number().optional(),
      system_expected_lbp: z.number().optional(),
      amounts: z.array(
        z.object({
          drawer_name: z.string().min(1),
          currency_code: z.string().min(1),
          physical_amount: z.number().nonnegative(),
          opening_amount: z.number().nonnegative().optional(),
        })
      ),
    });
    const parsed = schema.safeParse(data);
    if (!parsed.success) return { success: false, error: "Invalid payload" };

    closingLogger.info({ date: parsed.data.closing_date }, "Creating daily closing");
    return closingService.createDailyClosing(parsed.data);
  });

  // Update existing daily closing
  ipcMain.handle(
    "closing:update-daily-closing",
    (
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
      }
    ) => {
      try {
        const { requireRole } = require("../session");
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error } as any;
      } catch {}
      return closingService.updateDailyClosing(data);
    }
  );

  // Get daily stats snapshot
  ipcMain.handle("closing:get-daily-stats-snapshot", async () => {
    return closingService.getDailyStatsSnapshot();
  });

  // ==================== ACTIVITY & DIAGNOSTICS ====================

  // Diagnostics: list sync_errors
  ipcMain.handle("diagnostics:get-sync-errors", (e) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { error: "Forbidden" };
    } catch {}
    return activityService.getSyncErrors();
  });

  // Recent activity logs
  ipcMain.handle("activity:get-recent", (_e, limit?: number) => {
    return activityService.getRecentLogs(limit);
  });
}

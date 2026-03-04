import { ipcMain } from "electron";
import { z } from "zod";
import { requireRole } from "../session.js";
import {
  getSettingsService,
  getExpenseService,
  getClosingService,
  getActivityService,
  settingsLogger,
  expenseLogger,
  closingLogger,
} from "@liratek/core";
import { createRequire } from "module";

// ESM does not provide require(); create one so we can load CJS-only packages
const esmRequire = createRequire(import.meta.url);

export function registerDatabaseHandlers(): void {
  const settingsService = getSettingsService();
  const expenseService = getExpenseService();
  const closingService = getClosingService();
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
    return settingsService.updateSetting(key, value);
  });

  // Alias for settings:update
  ipcMain.handle("settings:update", (e, key: string, value: string) => {
    try {
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
        paid_by_method?: string;
        amount_usd: number;
        amount_lbp: number;
        expense_date: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}
      expenseLogger.info(
        { category: data.category, amountUSD: data.amount_usd },
        "Adding expense",
      );
      return expenseService.addExpense(data);
    },
  );

  // Get Today's Expenses
  ipcMain.handle("db:get-today-expenses", () => {
    return expenseService.getTodayExpenses();
  });

  // Delete Expense
  ipcMain.handle("db:delete-expense", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    return expenseService.deleteExpense(id);
  });

  // ==================== CLOSING ====================

  // Set Opening balances
  ipcMain.handle(
    "closing:set-opening-balances",
    (e, data: { drawer_name: string; balances: Record<string, number> }) => {
      try {
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
          }),
        ),
      });
      const parsed = schema.safeParse(data);
      if (!parsed.success) return { success: false, error: "Invalid payload" };

      closingLogger.info(
        { date: parsed.data.closing_date },
        "Setting opening balances",
      );
      return closingService.setOpeningBalances({
        closing_date: parsed.data.closing_date,
        amounts: parsed.data.amounts,
        ...(parsed.data.user_id != null
          ? { user_id: parsed.data.user_id }
          : {}),
      });
    },
  );

  // Get system expected balances (dynamic format: Record<drawerName, Record<currencyCode, balance>>)
  ipcMain.handle("closing:get-system-expected-balances-dynamic", async () => {
    return closingService.getSystemExpectedBalancesDynamic();
  });

  // Check if opening balance has been set for today
  ipcMain.handle("closing:has-opening-balance-today", async () => {
    try {
      return closingService.hasOpeningBalanceToday();
    } catch (error) {
      closingLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Error checking opening balance",
      );
      return false; // Default to false if error
    }
  });

  // Create daily closing
  ipcMain.handle(
    "closing:create-daily-closing",
    (e, data: { drawer_name: string; note?: string }) => {
      try {
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
          }),
        ),
      });
      const parsed = schema.safeParse(data);
      if (!parsed.success) return { success: false, error: "Invalid payload" };

      closingLogger.info(
        { date: parsed.data.closing_date },
        "Creating daily closing",
      );
      return closingService.createDailyClosing({
        closing_date: parsed.data.closing_date,
        amounts: parsed.data.amounts.map((amount) => ({
          drawer_name: amount.drawer_name,
          currency_code: amount.currency_code,
          physical_amount: amount.physical_amount,
          ...(amount.opening_amount != null
            ? { opening_amount: amount.opening_amount }
            : {}),
        })),
        ...(parsed.data.user_id != null
          ? { user_id: parsed.data.user_id }
          : {}),
        ...(parsed.data.variance_notes != null
          ? { variance_notes: parsed.data.variance_notes }
          : {}),
        ...(parsed.data.report_path != null
          ? { report_path: parsed.data.report_path }
          : {}),
        ...(parsed.data.system_expected_usd != null
          ? { system_expected_usd: parsed.data.system_expected_usd }
          : {}),
        ...(parsed.data.system_expected_lbp != null
          ? { system_expected_lbp: parsed.data.system_expected_lbp }
          : {}),
      });
    },
  );

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
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}
      return closingService.updateDailyClosing(data);
    },
  );

  // Get daily stats snapshot
  ipcMain.handle("closing:get-daily-stats-snapshot", async () => {
    return closingService.getDailyStatsSnapshot();
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

  // Recalculate drawer balances from payments journal
  ipcMain.handle("closing:recalculate-drawer-balances", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    closingLogger.info("Recalculating drawer balances from payments journal");
    return closingService.recalculateDrawerBalances();
  });

  // Diagnostics: run PRAGMA foreign_key_check
  ipcMain.handle("diagnostics:foreign-key-check", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    try {
      const { getDatabase } = esmRequire("../db");
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
}

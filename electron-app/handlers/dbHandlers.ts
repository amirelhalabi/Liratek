import { ipcMain } from "electron";
import { z } from "zod";
import {
  getSettingsService,
  getExpenseService,
  getClosingService,
  getActivityService,
  resolveDatabasePath,
  settingsLogger,
  expenseLogger,
  closingLogger,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import { AddExpenseSchema, validatePayload } from "../schemas/index.js";

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

  // ==================== CLOSING ====================

  // Set Opening balances
  ipcMain.handle(
    "closing:set-opening-balances",
    (e, data: { drawer_name: string; balances: Record<string, number> }) => {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

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
      const result = closingService.setOpeningBalances({
        closing_date: parsed.data.closing_date,
        amounts: parsed.data.amounts,
        user_id: parsed.data.user_id ?? auth.userId,
      });
      audit(e.sender.id, {
        action: "create",
        entity_type: "opening_balance",
        summary: `Set opening balances for ${parsed.data.closing_date}`,
      });
      return result;
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
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

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
      const result = closingService.createDailyClosing({
        closing_date: parsed.data.closing_date,
        amounts: parsed.data.amounts.map((amount) => ({
          drawer_name: amount.drawer_name,
          currency_code: amount.currency_code,
          physical_amount: amount.physical_amount,
          ...(amount.opening_amount != null
            ? { opening_amount: amount.opening_amount }
            : {}),
        })),
        user_id: parsed.data.user_id ?? auth.userId,
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
      audit(e.sender.id, {
        action: "create",
        entity_type: "daily_closing",
        summary: `Created daily closing for ${parsed.data.closing_date}`,
      });
      return result;
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

        const result = closingService.updateDailyClosing({
          ...data,
          user_id: data.user_id ?? auth.userId,
        });
        audit(e.sender.id, {
          action: "update",
          entity_type: "daily_closing",
          entity_id: String(data.id),
          summary: `Updated daily closing #${data.id}`,
        });
        return result;
      } catch {
        return { success: false, error: "Unauthorized" };
      }
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
    const result = closingService.recalculateDrawerBalances();
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
        type?: "OPENING" | "CLOSING" | "ALL";
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
}

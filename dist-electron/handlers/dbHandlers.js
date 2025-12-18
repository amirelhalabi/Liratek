"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDatabaseHandlers = registerDatabaseHandlers;
const electron_1 = require("electron");
const zod_1 = require("zod");
const SettingsService_1 = require("../services/SettingsService");
const ExpenseService_1 = require("../services/ExpenseService");
const ClosingService_1 = require("../services/ClosingService");
const ActivityService_1 = require("../services/ActivityService");
const logger_1 = require("../utils/logger");
function registerDatabaseHandlers() {
    const settingsService = new SettingsService_1.SettingsService();
    const expenseService = new ExpenseService_1.ExpenseService();
    const closingService = new ClosingService_1.ClosingService();
    const activityService = new ActivityService_1.ActivityService();
    // ==================== SETTINGS ====================
    // Get system settings
    electron_1.ipcMain.handle("db:get-settings", () => {
        return settingsService.getAllSettings();
    });
    // Alias for settings:get-all
    electron_1.ipcMain.handle("settings:get-all", () => {
        return settingsService.getAllSettings();
    });
    // Get setting by key
    electron_1.ipcMain.handle("db:get-setting", (_event, key) => {
        return settingsService.getSettingValue(key);
    });
    // Update setting
    electron_1.ipcMain.handle("db:update-setting", (e, key, value) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        logger_1.settingsLogger.info({ key }, "Updating setting");
        return settingsService.updateSetting(key, value);
    });
    // Alias for settings:update
    electron_1.ipcMain.handle("settings:update", (e, key, value) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        return settingsService.updateSetting(key, value);
    });
    // ==================== EXPENSES ====================
    // Add Expense
    electron_1.ipcMain.handle("db:add-expense", (e, data) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        logger_1.expenseLogger.info({ category: data.category, amountUSD: data.amount_usd }, "Adding expense");
        return expenseService.addExpense(data);
    });
    // Get Today's Expenses
    electron_1.ipcMain.handle("db:get-today-expenses", () => {
        return expenseService.getTodayExpenses();
    });
    // Delete Expense
    electron_1.ipcMain.handle("db:delete-expense", (e, id) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        return expenseService.deleteExpense(id);
    });
    // ==================== CLOSING ====================
    // Set Opening balances
    electron_1.ipcMain.handle("closing:set-opening-balances", (e, data) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        const schema = zod_1.z.object({
            closing_date: zod_1.z.string().min(8),
            user_id: zod_1.z.number().optional(),
            amounts: zod_1.z.array(zod_1.z.object({
                drawer_name: zod_1.z.string().min(1),
                currency_code: zod_1.z.string().min(1),
                opening_amount: zod_1.z.number().nonnegative(),
            })),
        });
        const parsed = schema.safeParse(data);
        if (!parsed.success)
            return { success: false, error: "Invalid payload" };
        logger_1.closingLogger.info({ date: parsed.data.closing_date }, "Setting opening balances");
        return closingService.setOpeningBalances(parsed.data);
    });
    // Get system expected balances
    electron_1.ipcMain.handle("closing:get-system-expected-balances", async () => {
        return closingService.getSystemExpectedBalances();
    });
    // Check if opening balance has been set for today
    electron_1.ipcMain.handle("closing:has-opening-balance-today", async () => {
        try {
            return closingService.hasOpeningBalanceToday();
        }
        catch (error) {
            logger_1.closingLogger.error({ error: error.message }, "Error checking opening balance");
            return false; // Default to false if error
        }
    });
    // Create daily closing
    electron_1.ipcMain.handle("closing:create-daily-closing", (e, data) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        const schema = zod_1.z.object({
            closing_date: zod_1.z.string().min(8),
            user_id: zod_1.z.number().optional(),
            variance_notes: zod_1.z.string().optional(),
            report_path: zod_1.z.string().optional(),
            system_expected_usd: zod_1.z.number().optional(),
            system_expected_lbp: zod_1.z.number().optional(),
            amounts: zod_1.z.array(zod_1.z.object({
                drawer_name: zod_1.z.string().min(1),
                currency_code: zod_1.z.string().min(1),
                physical_amount: zod_1.z.number().nonnegative(),
                opening_amount: zod_1.z.number().nonnegative().optional(),
            })),
        });
        const parsed = schema.safeParse(data);
        if (!parsed.success)
            return { success: false, error: "Invalid payload" };
        logger_1.closingLogger.info({ date: parsed.data.closing_date }, "Creating daily closing");
        return closingService.createDailyClosing(parsed.data);
    });
    // Update existing daily closing
    electron_1.ipcMain.handle("closing:update-daily-closing", (e, data) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        return closingService.updateDailyClosing(data);
    });
    // Get daily stats snapshot
    electron_1.ipcMain.handle("closing:get-daily-stats-snapshot", async () => {
        return closingService.getDailyStatsSnapshot();
    });
    // ==================== ACTIVITY & DIAGNOSTICS ====================
    // Diagnostics: list sync_errors
    electron_1.ipcMain.handle("diagnostics:get-sync-errors", (e) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { error: "Forbidden" };
        }
        catch { }
        return activityService.getSyncErrors();
    });
    // Recent activity logs
    electron_1.ipcMain.handle("activity:get-recent", (_e, limit) => {
        return activityService.getRecentLogs(limit);
    });
}

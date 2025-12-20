"use strict";
/**
 * Currency IPC Handlers
 *
 * Thin wrapper over CurrencyService for IPC communication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCurrencyHandlers = registerCurrencyHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
const session_1 = require("../session");
const logger_1 = require("../utils/logger");
function registerCurrencyHandlers() {
    const currencyService = (0, services_1.getCurrencyService)();
    // List all currencies
    electron_1.ipcMain.handle("currencies:list", () => {
        return currencyService.listCurrencies();
    });
    // Create a currency (admin only)
    electron_1.ipcMain.handle("currencies:create", (event, data) => {
        const auth = (0, session_1.requireRole)(event.sender.id, ["admin"]);
        if (!auth.ok)
            return { success: false, error: auth.error };
        logger_1.settingsLogger.info({ code: data.code, name: data.name }, "Creating currency");
        return currencyService.createCurrency(data);
    });
    // Update a currency (admin only)
    electron_1.ipcMain.handle("currencies:update", (event, data) => {
        const auth = (0, session_1.requireRole)(event.sender.id, ["admin"]);
        if (!auth.ok)
            return { success: false, error: auth.error };
        logger_1.settingsLogger.info({ id: data.id }, "Updating currency");
        const { id, ...updateData } = data;
        return currencyService.updateCurrency(id, updateData);
    });
    // Delete a currency (admin only)
    electron_1.ipcMain.handle("currencies:delete", (event, id) => {
        const auth = (0, session_1.requireRole)(event.sender.id, ["admin"]);
        if (!auth.ok)
            return { success: false, error: auth.error };
        logger_1.settingsLogger.info({ id }, "Deleting currency");
        return currencyService.deleteCurrency(id);
    });
}

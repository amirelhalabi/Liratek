"use strict";
/**
 * Rate IPC Handlers
 *
 * Thin wrapper over RateService for IPC communication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRateHandlers = registerRateHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
const session_1 = require("../session");
function registerRateHandlers() {
    const rateService = (0, services_1.getRateService)();
    // List all rates
    electron_1.ipcMain.handle('rates:list', () => {
        return rateService.listRates();
    });
    // Set a rate (admin only)
    electron_1.ipcMain.handle('rates:set', (event, data) => {
        const auth = (0, session_1.requireRole)(event.sender.id, ['admin']);
        if (!auth.ok)
            return { success: false, error: auth.error };
        return rateService.setRate(data);
    });
}

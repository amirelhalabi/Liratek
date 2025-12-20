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
const logger_1 = require("../utils/logger");
function registerRateHandlers() {
    const rateService = (0, services_1.getRateService)();
    // List all rates
    electron_1.ipcMain.handle("rates:list", () => {
        return rateService.listRates();
    });
    // Set a rate (admin only)
    electron_1.ipcMain.handle("rates:set", (event, data) => {
        const auth = (0, session_1.requireRole)(event.sender.id, ["admin"]);
        if (!auth.ok)
            return { success: false, error: auth.error };
        logger_1.settingsLogger.info({ fromCode: data.from_code, toCode: data.to_code, rate: data.rate }, "Setting rate");
        return rateService.setRate(data);
    });
}

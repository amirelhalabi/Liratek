"use strict";
/**
 * Recharge IPC Handlers
 *
 * Thin wrapper over RechargeService for IPC communication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRechargeHandlers = registerRechargeHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
const session_1 = require("../session");
const logger_1 = require("../utils/logger");
function registerRechargeHandlers() {
    const rechargeService = (0, services_1.getRechargeService)();
    // Get Virtual Stock
    electron_1.ipcMain.handle('recharge:get-stock', () => {
        return rechargeService.getStock();
    });
    // Process Recharge Transaction (admin only)
    electron_1.ipcMain.handle('recharge:process', (event, data) => {
        const auth = (0, session_1.requireRole)(event.sender.id, ['admin']);
        if (!auth.ok)
            return { success: false, error: auth.error };
        logger_1.rechargeLogger.info({ provider: data.provider, type: data.type, amount: data.amount }, 'Processing recharge');
        return rechargeService.processRecharge(data);
    });
}

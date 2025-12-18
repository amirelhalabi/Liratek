"use strict";
/**
 * Exchange IPC Handlers
 *
 * Thin wrapper over ExchangeService for IPC communication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExchangeHandlers = registerExchangeHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
function registerExchangeHandlers() {
    const exchangeService = (0, services_1.getExchangeService)();
    // Add Transaction (Drawer B - General Drawer)
    electron_1.ipcMain.handle('exchange:add-transaction', (_event, data) => {
        return exchangeService.addTransaction(data);
    });
    // Get History (last 50 transactions)
    electron_1.ipcMain.handle('exchange:get-history', () => {
        return exchangeService.getHistory();
    });
}

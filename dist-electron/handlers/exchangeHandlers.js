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
const logger_1 = require("../utils/logger");
function registerExchangeHandlers() {
    const exchangeService = (0, services_1.getExchangeService)();
    // Add Transaction (Drawer B - General Drawer)
    electron_1.ipcMain.handle('exchange:add-transaction', (_event, data) => {
        logger_1.exchangeLogger.info({ fromCurrency: data.fromCurrency, toCurrency: data.toCurrency, amountIn: data.amountIn }, 'Processing exchange');
        return exchangeService.addTransaction(data);
    });
    // Get History (last 50 transactions)
    electron_1.ipcMain.handle('exchange:get-history', () => {
        return exchangeService.getHistory();
    });
}

"use strict";
/**
 * OMT/WHISH/BOB IPC Handlers
 *
 * Thin wrapper over FinancialService for IPC communication.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerOMTHandlers = registerOMTHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
const logger_1 = require("../utils/logger");
function registerOMTHandlers() {
    const financialService = (0, services_1.getFinancialService)();
    // Add Transaction (Drawer A for OMT, Drawer B for WHISH/BOB/OTHER)
    electron_1.ipcMain.handle("omt:add-transaction", (_event, data) => {
        logger_1.financialLogger.info({
            provider: data.provider,
            serviceType: data.serviceType,
            amountUSD: data.amountUSD,
        }, "Processing financial service transaction");
        return financialService.addTransaction(data);
    });
    // Get History (Last 50 transactions)
    electron_1.ipcMain.handle("omt:get-history", (_event, provider) => {
        return financialService.getHistory(provider);
    });
    // Get Analytics (Today & Month totals)
    electron_1.ipcMain.handle("omt:get-analytics", () => {
        return financialService.getAnalytics();
    });
}

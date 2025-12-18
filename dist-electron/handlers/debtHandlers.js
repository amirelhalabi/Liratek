"use strict";
/**
 * Debt IPC Handlers
 *
 * Thin wrapper over DebtService for IPC communication.
 * Handles: IPC message routing to service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDebtHandlers = registerDebtHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
function registerDebtHandlers() {
    const debtService = (0, services_1.getDebtService)();
    // Get all debtors with their totals
    electron_1.ipcMain.handle('debt:get-debtors', () => {
        return debtService.getDebtors();
    });
    // Get debt history for a client
    electron_1.ipcMain.handle('debt:get-client-history', (_event, clientId) => {
        return debtService.getClientHistory(clientId);
    });
    // Get total debt for a client
    electron_1.ipcMain.handle('debt:get-client-total', (_event, clientId) => {
        return debtService.getClientTotal(clientId);
    });
    // Add a repayment
    electron_1.ipcMain.handle('debt:add-repayment', (_event, data) => {
        return debtService.addRepayment(data);
    });
    // Dashboard debt summary
    electron_1.ipcMain.handle('dashboard:get-debt-summary', () => {
        return debtService.getDebtSummary();
    });
}

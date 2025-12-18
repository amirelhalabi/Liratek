"use strict";
/**
 * Sales IPC Handlers
 *
 * Thin wrapper over SalesService for IPC communication.
 * Handles: IPC message routing to service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSalesHandlers = registerSalesHandlers;
const electron_1 = require("electron");
const services_1 = require("../services");
function registerSalesHandlers() {
    const salesService = (0, services_1.getSalesService)();
    // Process a sale (create or update)
    electron_1.ipcMain.handle('sales:process', (_event, sale) => {
        return salesService.processSale(sale);
    });
    // Get Drafts
    electron_1.ipcMain.handle('sales:get-drafts', () => {
        return salesService.getDrafts();
    });
    // Dashboard Stats
    electron_1.ipcMain.handle('sales:get-dashboard-stats', () => {
        return salesService.getDashboardStats();
    });
    // Chart Data (Sales or Profit for last 30 days)
    electron_1.ipcMain.handle('dashboard:get-profit-sales-chart', (_event, type) => {
        return salesService.getChartData(type);
    });
    // Drawer Balances
    electron_1.ipcMain.handle('dashboard:get-drawer-balances', () => {
        return salesService.getDrawerBalances();
    });
    // Today's Sales for Dashboard card
    electron_1.ipcMain.handle('sales:get-todays-sales', () => {
        return salesService.getTodaysSales();
    });
    // Top Products
    electron_1.ipcMain.handle('sales:get-top-products', () => {
        return salesService.getTopProducts();
    });
}

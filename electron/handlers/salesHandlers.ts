/**
 * Sales IPC Handlers
 * 
 * Thin wrapper over SalesService for IPC communication.
 * Handles: IPC message routing to service
 */

import { ipcMain } from 'electron';
import { getSalesService } from '../services';
import type { SaleRequest } from '../database/repositories';

export function registerSalesHandlers(): void {
  const salesService = getSalesService();

  // Process a sale (create or update)
  ipcMain.handle('sales:process', (_event, sale: SaleRequest) => {
    return salesService.processSale(sale);
  });

  // Get Drafts
  ipcMain.handle('sales:get-drafts', () => {
    return salesService.getDrafts();
  });

  // Dashboard Stats
  ipcMain.handle('sales:get-dashboard-stats', () => {
    return salesService.getDashboardStats();
  });

  // Chart Data (Sales or Profit for last 30 days)
  ipcMain.handle('dashboard:get-profit-sales-chart', (_event, type: 'Sales' | 'Profit') => {
    return salesService.getChartData(type);
  });

  // Drawer Balances
  ipcMain.handle('dashboard:get-drawer-balances', () => {
    return salesService.getDrawerBalances();
  });

  // Today's Sales for Dashboard card
  ipcMain.handle('sales:get-todays-sales', () => {
    return salesService.getTodaysSales();
  });

  // Top Products
  ipcMain.handle('sales:get-top-products', () => {
    return salesService.getTopProducts();
  });
}

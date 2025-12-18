/**
 * Currency IPC Handlers
 * 
 * Thin wrapper over CurrencyService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getCurrencyService } from '../services';
import { requireRole } from '../session';
import type { CreateCurrencyData, UpdateCurrencyData } from '../database/repositories';

export function registerCurrencyHandlers(): void {
  const currencyService = getCurrencyService();

  // List all currencies
  ipcMain.handle('currencies:list', () => {
    return currencyService.listCurrencies();
  });

  // Create a currency (admin only)
  ipcMain.handle('currencies:create', (event: IpcMainInvokeEvent, data: CreateCurrencyData) => {
    const auth = requireRole(event.sender.id, ['admin']);
    if (!auth.ok) return { success: false, error: auth.error };

    return currencyService.createCurrency(data);
  });

  // Update a currency (admin only)
  ipcMain.handle('currencies:update', (event: IpcMainInvokeEvent, data: { id: number } & UpdateCurrencyData) => {
    const auth = requireRole(event.sender.id, ['admin']);
    if (!auth.ok) return { success: false, error: auth.error };

    const { id, ...updateData } = data;
    return currencyService.updateCurrency(id, updateData);
  });

  // Delete a currency (admin only)
  ipcMain.handle('currencies:delete', (event: IpcMainInvokeEvent, id: number) => {
    const auth = requireRole(event.sender.id, ['admin']);
    if (!auth.ok) return { success: false, error: auth.error };

    return currencyService.deleteCurrency(id);
  });
}

/**
 * Rate IPC Handlers
 * 
 * Thin wrapper over RateService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getRateService } from '../services';
import { requireRole } from '../session';
import type { SetRateData } from '../database/repositories';

export function registerRateHandlers(): void {
  const rateService = getRateService();

  // List all rates
  ipcMain.handle('rates:list', () => {
    return rateService.listRates();
  });

  // Set a rate (admin only)
  ipcMain.handle('rates:set', (event: IpcMainInvokeEvent, data: SetRateData) => {
    const auth = requireRole(event.sender.id, ['admin']);
    if (!auth.ok) return { success: false, error: auth.error };

    return rateService.setRate(data);
  });
}

/**
 * Recharge IPC Handlers
 * 
 * Thin wrapper over RechargeService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getRechargeService } from '../services';
import { requireRole } from '../session';
import type { RechargeData } from '../database/repositories';

export function registerRechargeHandlers(): void {
  const rechargeService = getRechargeService();

  // Get Virtual Stock
  ipcMain.handle('recharge:get-stock', () => {
    return rechargeService.getStock();
  });

  // Process Recharge Transaction (admin only)
  ipcMain.handle('recharge:process', (event: IpcMainInvokeEvent, data: RechargeData) => {
    const auth = requireRole(event.sender.id, ['admin']);
    if (!auth.ok) return { success: false, error: auth.error };

    return rechargeService.processRecharge(data);
  });
}

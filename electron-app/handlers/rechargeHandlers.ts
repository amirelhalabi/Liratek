/**
 * Recharge IPC Handlers
 *
 * Thin wrapper over RechargeService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getRechargeService } from "../services/index.js";
import { requireRole } from "../session.js";
import { rechargeLogger } from "../utils/logger.js";
import type { RechargeData } from "../database/repositories/index.js";

export function registerRechargeHandlers(): void {
  const rechargeService = getRechargeService();

  // Get Virtual Stock
  ipcMain.handle("recharge:get-stock", () => {
    return rechargeService.getStock();
  });

  // Process Recharge Transaction (admin only)
  ipcMain.handle(
    "recharge:process",
    (event: IpcMainInvokeEvent, data: RechargeData) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      rechargeLogger.info(
        { provider: data.provider, type: data.type, amount: data.amount },
        "Processing recharge",
      );
      return rechargeService.processRecharge(data);
    },
  );
}

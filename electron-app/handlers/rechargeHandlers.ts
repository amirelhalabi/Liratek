/**
 * Recharge IPC Handlers
 *
 * Thin wrapper over RechargeService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getRechargeService, rechargeLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import type { RechargeData } from "@liratek/core";

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

  // Top up MTC/Alfa balance (admin only)
  ipcMain.handle(
    "recharge:top-up",
    (
      event: IpcMainInvokeEvent,
      data: { provider: "MTC" | "Alfa"; amount: number; currency?: string },
    ) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      rechargeLogger.info(
        { provider: data.provider, amount: data.amount },
        "Processing top-up",
      );
      return rechargeService.topUp(data);
    },
  );
}

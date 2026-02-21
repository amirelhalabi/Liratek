/**
 * Rate IPC Handlers
 *
 * Thin wrapper over RateService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getRateService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import type { SetRateData } from "@liratek/core";

export function registerRateHandlers(): void {
  const rateService = getRateService();

  // List all rates
  ipcMain.handle("rates:list", () => {
    return rateService.listRates();
  });

  // Set a rate (admin only)
  ipcMain.handle(
    "rates:set",
    (event: IpcMainInvokeEvent, data: SetRateData) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info(
        { fromCode: data.from_code, toCode: data.to_code, rate: data.rate },
        "Setting rate",
      );
      return rateService.setRate(data);
    },
  );
}

/**
 * Rate IPC Handlers
 *
 * Thin wrapper over RateService for IPC communication.
 * New schema (v30): one row per non-USD currency (to_code, market_rate, delta, is_stronger)
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

  // Set / upsert a rate (admin only)
  // Payload: { to_code, market_rate, delta, is_stronger }
  ipcMain.handle(
    "rates:set",
    (event: IpcMainInvokeEvent, data: SetRateData) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info(
        {
          toCode: data.to_code,
          marketRate: data.market_rate,
          delta: data.delta,
          isStronger: data.is_stronger,
        },
        "Setting rate",
      );
      return rateService.setRate(data);
    },
  );

  // Delete a rate by currency code (admin only)
  ipcMain.handle(
    "rates:delete",
    (event: IpcMainInvokeEvent, toCode: string) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ toCode }, "Deleting rate");
      return rateService.deleteRate(toCode, "USD");
    },
  );
}

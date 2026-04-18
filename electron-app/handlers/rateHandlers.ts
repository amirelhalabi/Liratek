/**
 * Rate IPC Handlers
 *
 * Thin wrapper over RateService for IPC communication.
 * New schema (v30): one row per non-USD currency (to_code, market_rate, delta, is_stronger)
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getRateService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
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
      const result = rateService.setRate(data);
      audit(event.sender.id, {
        action: "update",
        entity_type: "exchange_rate",
        entity_id: data.to_code,
        summary: `Set rate USD→${data.to_code}: market=${data.market_rate}, delta=${data.delta}`,
        new_values: {
          market_rate: data.market_rate,
          delta: data.delta,
          is_stronger: data.is_stronger,
        },
      });
      return result;
    },
  );

  // Delete a rate by currency code (admin only)
  ipcMain.handle(
    "rates:delete",
    (event: IpcMainInvokeEvent, toCode: string) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ toCode }, "Deleting rate");
      const result = rateService.deleteRate(toCode, "USD");
      audit(event.sender.id, {
        action: "delete",
        entity_type: "exchange_rate",
        entity_id: toCode,
        summary: `Deleted rate USD→${toCode}`,
      });
      return result;
    },
  );
}

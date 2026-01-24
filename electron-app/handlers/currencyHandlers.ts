/**
 * Currency IPC Handlers
 *
 * Thin wrapper over CurrencyService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getCurrencyService } from "../services/index.js";
import { requireRole } from "../session.js";
import { settingsLogger } from "../utils/logger.js";
import type {
  CreateCurrencyData,
  UpdateCurrencyData,
} from "../database/repositories/index.js";

export function registerCurrencyHandlers(): void {
  const currencyService = getCurrencyService();

  // List all currencies
  ipcMain.handle("currencies:list", () => {
    return currencyService.listCurrencies();
  });

  // Create a currency (admin only)
  ipcMain.handle(
    "currencies:create",
    (event: IpcMainInvokeEvent, data: CreateCurrencyData) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info(
        { code: data.code, name: data.name },
        "Creating currency",
      );
      return currencyService.createCurrency(data);
    },
  );

  // Update a currency (admin only)
  ipcMain.handle(
    "currencies:update",
    (event: IpcMainInvokeEvent, data: { id: number } & UpdateCurrencyData) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ id: data.id }, "Updating currency");
      const { id, ...updateData } = data;
      return currencyService.updateCurrency(id, updateData);
    },
  );

  // Delete a currency (admin only)
  ipcMain.handle(
    "currencies:delete",
    (event: IpcMainInvokeEvent, id: number) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ id }, "Deleting currency");
      return currencyService.deleteCurrency(id);
    },
  );
}

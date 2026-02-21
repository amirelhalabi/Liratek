/**
 * Currency IPC Handlers
 *
 * Thin wrapper over CurrencyService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getCurrencyService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import type { CreateCurrencyData, UpdateCurrencyData } from "@liratek/core";

export function registerCurrencyHandlers(): void {
  const currencyService = getCurrencyService();

  // List all currencies
  ipcMain.handle("currencies:list", () => {
    const result = currencyService.listCurrencies();
    return Array.isArray(result) ? result : [];
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

  // =========================================================================
  // Currency–Module Junction
  // =========================================================================

  // Get module keys enabled for a currency
  ipcMain.handle("currencies:getModules", (_event, code: string) => {
    return currencyService.getModulesForCurrency(code);
  });

  // Get currencies enabled for a module
  ipcMain.handle("currencies:byModule", (_event, moduleKey: string) => {
    return currencyService.getCurrenciesForModule(moduleKey);
  });

  // Set modules for a currency (admin only)
  ipcMain.handle(
    "currencies:setModules",
    (event: IpcMainInvokeEvent, code: string, modules: string[]) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ code, modules }, "Setting modules for currency");
      return currencyService.setModulesForCurrency(code, modules);
    },
  );

  // =========================================================================
  // Currency–Drawer Junction
  // =========================================================================

  // Get all drawer-currency mappings
  ipcMain.handle("currencies:allDrawerCurrencies", () => {
    return currencyService.getAllDrawerCurrencies();
  });

  // Get currencies enabled for a drawer
  ipcMain.handle("currencies:forDrawer", (_event, drawerName: string) => {
    return currencyService.getCurrenciesForDrawer(drawerName);
  });

  // Get full currency entities for a drawer (mirrors byModule)
  ipcMain.handle("currencies:fullForDrawer", (_event, drawerName: string) => {
    return currencyService.getFullCurrenciesForDrawer(drawerName);
  });

  // Get drawers enabled for a currency
  ipcMain.handle("currencies:getDrawers", (_event, code: string) => {
    return currencyService.getDrawersForCurrency(code);
  });

  // Set currencies for a drawer (admin only)
  ipcMain.handle(
    "currencies:setDrawerCurrencies",
    (event: IpcMainInvokeEvent, drawerName: string, currencies: string[]) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info(
        { drawerName, currencies },
        "Setting currencies for drawer",
      );
      return currencyService.setCurrenciesForDrawer(drawerName, currencies);
    },
  );

  // Get configured drawer names
  ipcMain.handle("currencies:configuredDrawers", () => {
    return currencyService.getConfiguredDrawerNames();
  });
}

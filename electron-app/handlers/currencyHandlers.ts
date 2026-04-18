/**
 * Currency IPC Handlers
 *
 * Thin wrapper over CurrencyService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getCurrencyService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
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
      const result = currencyService.createCurrency(data);
      audit(event.sender.id, {
        action: "create",
        entity_type: "currency",
        entity_id: data.code,
        summary: `Created currency "${data.code}" (${data.name})`,
      });
      return result;
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
      const result = currencyService.updateCurrency(id, updateData);
      audit(event.sender.id, {
        action: "update",
        entity_type: "currency",
        entity_id: String(id),
        summary: `Updated currency #${id}`,
      });
      return result;
    },
  );

  // Delete a currency (admin only)
  ipcMain.handle(
    "currencies:delete",
    (event: IpcMainInvokeEvent, id: number) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ id }, "Deleting currency");
      const result = currencyService.deleteCurrency(id);
      audit(event.sender.id, {
        action: "delete",
        entity_type: "currency",
        entity_id: String(id),
        summary: `Deleted currency #${id}`,
      });
      return result;
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
      const result = currencyService.setModulesForCurrency(code, modules);
      audit(event.sender.id, {
        action: "update",
        entity_type: "currency_modules",
        entity_id: code,
        summary: `Set modules for currency ${code}`,
        new_values: { modules },
      });
      return result;
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
      const result = currencyService.setCurrenciesForDrawer(
        drawerName,
        currencies,
      );
      audit(event.sender.id, {
        action: "update",
        entity_type: "currency_drawers",
        entity_id: drawerName,
        summary: `Set currencies for drawer ${drawerName}`,
        new_values: { currencies },
      });
      return result;
    },
  );

  // Get configured drawer names
  ipcMain.handle("currencies:configuredDrawers", () => {
    return currencyService.getConfiguredDrawerNames();
  });
}

/**
 * Module IPC Handlers
 *
 * Thin wrapper over ModuleService for IPC communication.
 * Manages sidebar module enable/disable and module listing.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getModuleService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";

export function registerModuleHandlers(): void {
  const moduleService = getModuleService();

  // List all modules
  ipcMain.handle("modules:list", () => {
    try {
      return moduleService.getAll();
    } catch {
      return [];
    }
  });

  // Get enabled modules (for sidebar)
  ipcMain.handle("modules:enabled", () => {
    try {
      return moduleService.getEnabledModules();
    } catch {
      return [];
    }
  });

  // Get toggleable modules (non-system, for Settings > Modules)
  ipcMain.handle("modules:toggleable", () => {
    try {
      return moduleService.getToggleableModules();
    } catch {
      return [];
    }
  });

  // Enable or disable a single module (admin only)
  ipcMain.handle(
    "modules:setEnabled",
    (event: IpcMainInvokeEvent, key: string, enabled: boolean) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ key, enabled }, "Toggling module");
      return moduleService.setModuleEnabled(key, enabled);
    },
  );

  // Bulk enable/disable modules (admin only)
  ipcMain.handle(
    "modules:bulkSetEnabled",
    (
      event: IpcMainInvokeEvent,
      updates: { key: string; is_enabled: boolean }[],
    ) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      settingsLogger.info({ count: updates.length }, "Bulk toggling modules");
      return moduleService.bulkSetEnabled(updates);
    },
  );
}

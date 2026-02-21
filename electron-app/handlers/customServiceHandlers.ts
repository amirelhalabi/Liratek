/**
 * Custom Service IPC Handlers
 *
 * Thin wrapper over CustomServiceService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getCustomServiceService, customServiceLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import type { CreateCustomServiceInput } from "@liratek/core";

export function registerCustomServiceHandlers(): void {
  const service = getCustomServiceService();

  // List custom services (optional filter)
  ipcMain.handle(
    "custom-services:list",
    (_event: IpcMainInvokeEvent, filter?: { date?: string }) => {
      return service.getServices(filter);
    },
  );

  // Get single custom service by ID
  ipcMain.handle(
    "custom-services:get",
    (_event: IpcMainInvokeEvent, id: number) => {
      return service.getServiceById(id);
    },
  );

  // Get today's summary
  ipcMain.handle("custom-services:summary", () => {
    return service.getTodaySummary();
  });

  // Add custom service (admin only)
  ipcMain.handle(
    "custom-services:add",
    (event: IpcMainInvokeEvent, data: CreateCustomServiceInput) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      customServiceLogger.info(
        { description: data.description, paid_by: data.paid_by },
        "Adding custom service",
      );
      return service.addService(data);
    },
  );

  // Delete custom service (admin only)
  ipcMain.handle(
    "custom-services:delete",
    (event: IpcMainInvokeEvent, id: number) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      customServiceLogger.info({ id }, "Deleting custom service");
      return service.deleteService(id);
    },
  );
}

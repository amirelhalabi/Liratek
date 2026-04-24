/**
 * Custom Service IPC Handlers
 *
 * Thin wrapper over CustomServiceService for IPC communication.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getCustomServiceService, customServiceLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import type { CreateCustomServiceInput } from "@liratek/core";
import {
  CustomServiceCreateSchema,
  validatePayload,
} from "../schemas/index.js";

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

      const v = validatePayload(CustomServiceCreateSchema, data);
      if (!v.ok) return { success: false, error: v.error };

      customServiceLogger.info(
        { description: v.data.description, paid_by: v.data.paid_by },
        "Adding custom service",
      );
      const result = service.addService(v.data as CreateCustomServiceInput);
      audit(event.sender.id, {
        action: "create",
        entity_type: "custom_service",
        summary: `Custom service: ${v.data.description}`,
        metadata: {
          description: v.data.description,
          paid_by: v.data.paid_by,
        },
      });
      return result;
    },
  );

  // Delete custom service (admin only)
  ipcMain.handle(
    "custom-services:delete",
    (event: IpcMainInvokeEvent, id: number) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      customServiceLogger.info({ id }, "Deleting custom service");
      const result = service.deleteService(id);
      audit(event.sender.id, {
        action: "delete",
        entity_type: "custom_service",
        entity_id: String(id),
        summary: `Deleted custom service #${id}`,
      });
      return result;
    },
  );
}

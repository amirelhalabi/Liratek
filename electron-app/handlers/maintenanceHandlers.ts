import { ipcMain } from "electron";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  getMaintenanceService,
  maintenanceLogger,
  getUserRepository,
  type SaveJobParams,
} from "@liratek/core";
import {
  MaintenanceJobSchema,
  GetMaintenanceStatusHistorySchema,
  validatePayload,
} from "../schemas/index.js";

export function registerMaintenanceHandlers(): void {
  const service = getMaintenanceService();

  // Add / Update Maintenance Job (Drawer B - General Drawer)
  ipcMain.handle("maintenance:save", (e, job: SaveJobParams) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    const v = validatePayload(MaintenanceJobSchema, job);
    if (!v.ok) return { success: false, error: v.error };

    maintenanceLogger.info(
      { jobId: v.data.id, device: v.data.device_name },
      "Saving maintenance job",
    );
    const result = service.saveJob(v.data as SaveJobParams);
    audit(e.sender.id, {
      action: v.data.id ? "update" : "create",
      entity_type: "maintenance_job",
      entity_id: String(v.data.id ?? (result as any)?.id ?? ""),
      summary: `${v.data.id ? "Updated" : "Created"} maintenance job: ${v.data.device_name}`,
    });
    return result;
  });

  // Get Jobs
  ipcMain.handle("maintenance:get-jobs", (_event, statusFilter?: string) => {
    return service.getJobs(statusFilter);
  });

  // Get one job's status transition history (LIRA-176 phase 6). No
  // requireRole call, matching maintenance:get-jobs above — this file's
  // existing read channel carries no role restriction, so this one doesn't
  // introduce a new one either. Reads return the RAW array, matching
  // maintenance:get-jobs's own `return service.getJobs(...)` — a validation
  // failure or thrown error is logged and swallowed to `[]`, the same way
  // MaintenanceService.getJobs already swallows its own errors, so the
  // renderer never gets a shape it doesn't expect.
  ipcMain.handle("maintenance:getStatusHistory", (_event, data: unknown) => {
    const v = validatePayload(GetMaintenanceStatusHistorySchema, data);
    if (!v.ok) {
      maintenanceLogger.error(
        { error: v.error },
        "maintenance:getStatusHistory validation failed",
      );
      return [];
    }

    try {
      return service.getStatusHistory(v.data.id);
    } catch (error) {
      maintenanceLogger.error({ error }, "maintenance:getStatusHistory failed");
      return [];
    }
  });

  // Delete / Cancel
  ipcMain.handle("maintenance:delete", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    maintenanceLogger.info({ jobId: id }, "Deleting maintenance job");
    const result = service.deleteJob(id);
    audit(e.sender.id, {
      action: "delete",
      entity_type: "maintenance_job",
      entity_id: String(id),
      summary: `Deleted maintenance job #${id}`,
    });
    return result;
  });

  // Update maintenance job metadata (staff and admin)
  ipcMain.handle(
    "maintenance:update-metadata",
    (
      e,
      data: {
        id: number;
        client_name?: string;
        device_name?: string;
        issue_description?: string;
        note?: string;
      },
    ) => {
      const auth = requireRole(e.sender.id, ["admin", "staff"]);
      if (!auth.ok) return { success: false, error: auth.error };

      let editedBy = `user-${auth.userId}`;
      try {
        const userRepo = getUserRepository();
        const user = userRepo.findById(auth.userId);
        if (user) editedBy = user.username;
      } catch {
        // fallback to user-{id}
      }

      const result = service.updateMaintenanceMetadata(
        data.id,
        {
          client_name: data.client_name,
          device_name: data.device_name,
          issue_description: data.issue_description,
          note: data.note,
        },
        editedBy,
      );

      if (
        result.success &&
        result.oldValues &&
        Object.keys(result.oldValues).length > 0
      ) {
        audit(e.sender.id, {
          action: "edit_metadata",
          entity_type: "maintenance_job",
          entity_id: String(data.id),
          summary: `Edited maintenance job #${data.id} metadata`,
          old_values: result.oldValues,
          new_values: data,
        });
      }

      return result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error };
    },
  );
}

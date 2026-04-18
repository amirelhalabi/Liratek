import { ipcMain } from "electron";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  getMaintenanceService,
  maintenanceLogger,
  type SaveJobParams,
} from "@liratek/core";
import { MaintenanceJobSchema, validatePayload } from "../schemas/index.js";

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
}

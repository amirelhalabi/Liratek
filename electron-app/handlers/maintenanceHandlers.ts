import { ipcMain } from "electron";
import { requireRole } from "../session.js";
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
    return service.saveJob(v.data as SaveJobParams);
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
    return service.deleteJob(id);
  });
}

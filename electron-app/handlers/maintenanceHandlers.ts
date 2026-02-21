import { ipcMain } from "electron";
import {
  getMaintenanceService,
  maintenanceLogger,
  type SaveJobParams,
} from "@liratek/core";
/* eslint-disable @typescript-eslint/no-require-imports */

export function registerMaintenanceHandlers(): void {
  const service = getMaintenanceService();

  // Add / Update Maintenance Job (Drawer B - General Drawer)
  ipcMain.handle("maintenance:save", (e, job: SaveJobParams) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    maintenanceLogger.info(
      { jobId: job.id, device: job.device_name },
      "Saving maintenance job",
    );
    return service.saveJob(job);
  });

  // Get Jobs
  ipcMain.handle("maintenance:get-jobs", (_event, statusFilter?: string) => {
    return service.getJobs(statusFilter);
  });

  // Delete / Cancel
  ipcMain.handle("maintenance:delete", (e, id: number) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    maintenanceLogger.info({ jobId: id }, "Deleting maintenance job");
    return service.deleteJob(id);
  });
}

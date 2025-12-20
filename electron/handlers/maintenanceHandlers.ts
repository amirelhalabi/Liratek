import { ipcMain } from "electron";
import { MaintenanceService } from "../services/MaintenanceService";
import { maintenanceLogger } from "../utils/logger";

export function registerMaintenanceHandlers(): void {
  const service = new MaintenanceService();

  // Add / Update Maintenance Job (Drawer B - General Drawer)
  ipcMain.handle("maintenance:save", (e, job: any) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}
    maintenanceLogger.info({ jobId: job.id, device: job.device_type }, "Saving maintenance job");
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

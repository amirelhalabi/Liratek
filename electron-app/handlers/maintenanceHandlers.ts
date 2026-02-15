import { ipcMain } from "electron";
import { getMaintenanceService, maintenanceLogger } from "@liratek/core";
/* eslint-disable @typescript-eslint/no-require-imports */

export function registerMaintenanceHandlers(): void {
  const service = getMaintenanceService();

  // Add / Update Maintenance Job (Drawer B - General Drawer)
  type MaintenanceJobInput = {
    id?: number;
    device_name: string;
    issue_description: string;
    estimated_cost_usd?: number;
    repair_price_usd?: number;
    status?: string;
    client_name?: string;
    client_phone?: string;
  };

  ipcMain.handle("maintenance:save", (e, job: MaintenanceJobInput) => {
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

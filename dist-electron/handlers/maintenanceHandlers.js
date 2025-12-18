"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMaintenanceHandlers = registerMaintenanceHandlers;
const electron_1 = require("electron");
const MaintenanceService_1 = require("../services/MaintenanceService");
const logger_1 = require("../utils/logger");
function registerMaintenanceHandlers() {
    const service = new MaintenanceService_1.MaintenanceService();
    // Add / Update Maintenance Job (Drawer B - General Drawer)
    electron_1.ipcMain.handle("maintenance:save", (e, job) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        logger_1.maintenanceLogger.info({ jobId: job.id, device: job.device_type }, "Saving maintenance job");
        return service.saveJob(job);
    });
    // Get Jobs
    electron_1.ipcMain.handle("maintenance:get-jobs", (_event, statusFilter) => {
        return service.getJobs(statusFilter);
    });
    // Delete / Cancel
    electron_1.ipcMain.handle("maintenance:delete", (e, id) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(e.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        logger_1.maintenanceLogger.info({ jobId: id }, "Deleting maintenance job");
        return service.deleteJob(id);
    });
}

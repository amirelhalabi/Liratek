"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReportHandlers = registerReportHandlers;
const electron_1 = require("electron");
const ReportService_1 = require("../services/ReportService");
const logger_1 = require("../utils/logger");
/* eslint-disable @typescript-eslint/no-require-imports */
function registerReportHandlers() {
    const service = new ReportService_1.ReportService();
    electron_1.ipcMain.handle("report:generate-pdf", async (event, data) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(event.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        logger_1.dbLogger.info({ filename: data.filename }, 'Generating PDF report');
        return service.generatePdf(data.html, data.filename);
    });
    // Backup database to Documents/LiratekBackups
    electron_1.ipcMain.handle("report:backup-db", async (event) => {
        try {
            const { requireRole } = require("../session");
            const auth = requireRole(event.sender.id, ["admin"]);
            if (!auth.ok)
                return { success: false, error: auth.error };
        }
        catch { }
        logger_1.dbLogger.info('Creating database backup');
        return service.backupDatabase();
    });
}

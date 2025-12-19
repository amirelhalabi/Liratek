import { ipcMain } from "electron";
import { ReportService } from "../services/ReportService";
import { dbLogger } from "../utils/logger";
/* eslint-disable @typescript-eslint/no-require-imports */

export function registerReportHandlers(): void {
  const service = new ReportService();

  ipcMain.handle(
    "report:generate-pdf",
    async (event, data: { html: string; filename?: string }) => {
      try {
        const { requireRole } = require("../session");
        const auth = requireRole(event.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      dbLogger.info({ filename: data.filename }, 'Generating PDF report');
      return service.generatePdf(data.html, data.filename);
    }
  );

  // Backup database to Documents/LiratekBackups
  ipcMain.handle("report:backup-db", async (event) => {
    try {
      const { requireRole } = require("../session");
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    dbLogger.info('Creating database backup');
    return service.backupDatabase();
  });
}

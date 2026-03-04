import { ipcMain } from "electron";
import { ReportService } from "../services/ReportService.js";
import { dbLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { createRequire } from "module";

// ESM does not provide require(); create one so we can load CJS-only packages
const esmRequire = createRequire(import.meta.url);

export function registerReportHandlers(): void {
  const service = new ReportService();

  ipcMain.handle(
    "report:generate-pdf",
    async (event, data: { html: string; filename?: string }) => {
      try {
        const auth = requireRole(event.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      dbLogger.info({ filename: data.filename }, "Generating PDF report");
      return service.generatePdf(data.html, data.filename);
    },
  );

  // Backup database to Documents/LiratekBackups
  ipcMain.handle("report:backup-db", async (event) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    dbLogger.info("Creating database backup");
    const res = await service.backupDatabase();
    if (res.success) {
      try {
        const { SettingsService } = esmRequire("../services/SettingsService");
        const settings = new SettingsService();
        settings.updateSetting("last_backup_at", new Date().toISOString());

        const verifyEnabled =
          Number(
            settings.getSettingValue("auto_backup_verify_enabled")?.value ?? 0,
          ) === 1;
        if (verifyEnabled && res.path) {
          const v = await service.verifyBackup(res.path);
          settings.updateSetting(
            "last_backup_verify_at",
            new Date().toISOString(),
          );
          settings.updateSetting("last_backup_verify_ok", v.ok ? "1" : "0");
        }
      } catch {}
    }
    return res;
  });

  ipcMain.handle("report:list-backups", async (event) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    return service.listBackups();
  });

  ipcMain.handle(
    "report:verify-backup",
    async (event, data: { path: string }) => {
      try {
        const auth = requireRole(event.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      return service.verifyBackup(data.path);
    },
  );

  ipcMain.handle("report:restore-db", async (event, data: { path: string }) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

    // Restoring requires app restart; do the file replace then relaunch.
    const res = await service.restoreDatabaseFromBackup(data.path);
    if (!res.success) return res;

    try {
      // Close DB connection if open

      const { closeDatabase } = esmRequire("../db");
      closeDatabase();
    } catch {}

    try {
      const { app } = esmRequire("electron");
      app.relaunch();
      app.exit(0);
    } catch {}

    return { success: true };
  });
}

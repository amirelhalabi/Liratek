import { BrowserWindow, app } from "electron";
import path from "path";
import fs from "fs";
import { toErrorString } from "../utils/errors.js";
export class ReportService {
    getBackupsDir() {
        return path.join(app.getPath("documents"), "LiratekBackups");
    }
    getDbPath() {
        return path.join(app.getPath("userData"), "phone_shop.db");
    }
    /**
     * Generate a PDF from HTML content
     */
    async generatePdf(html, filename) {
        const content = html || "<html><body><pre>No content</pre></body></html>";
        const outputFilename = filename || `report_${Date.now()}.pdf`;
        // Create hidden window to render HTML
        const win = new BrowserWindow({
            show: false,
            webPreferences: {
                offscreen: true,
            },
        });
        try {
            // Load the HTML via a data URL
            const dataUrl = "data:text/html;charset=UTF-8," + encodeURIComponent(content);
            await win.loadURL(dataUrl);
            const pdfBuffer = await win.webContents.printToPDF({
                printBackground: true,
                margins: {
                    top: 0.4,
                    bottom: 0.4,
                    left: 0.4,
                    right: 0.4,
                },
                pageSize: "A4",
            });
            const reportsDir = path.join(app.getPath("documents"), "LiratekReports");
            if (!fs.existsSync(reportsDir)) {
                fs.mkdirSync(reportsDir, { recursive: true });
            }
            const outPath = path.join(reportsDir, outputFilename);
            fs.writeFileSync(outPath, pdfBuffer);
            return { success: true, path: outPath };
        }
        catch (error) {
            console.error("Failed to generate PDF report:", error);
            return { success: false, error: toErrorString(error) };
        }
        finally {
            win.destroy();
        }
    }
    /**
     * Backup the database to Documents/LiratekBackups
     */
    async backupDatabase() {
        try {
            const dbPath = this.getDbPath();
            const backupsDir = this.getBackupsDir();
            if (!fs.existsSync(backupsDir)) {
                fs.mkdirSync(backupsDir, { recursive: true });
            }
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const outPath = path.join(backupsDir, `backup_${ts}.sqlite`);
            fs.copyFileSync(dbPath, outPath);
            return { success: true, path: outPath };
        }
        catch (error) {
            console.error("Failed to backup database:", error);
            return { success: false, error: toErrorString(error) };
        }
    }
    /**
     * List backups in Documents/LiratekBackups
     */
    async listBackups() {
        try {
            const dir = this.getBackupsDir();
            if (!fs.existsSync(dir))
                return { success: true, backups: [] };
            const backups = fs
                .readdirSync(dir)
                .filter((f) => f.endsWith(".sqlite") && f.startsWith("backup_"))
                .map((filename) => {
                const fullPath = path.join(dir, filename);
                const stat = fs.statSync(fullPath);
                return { path: fullPath, filename, createdAtMs: stat.mtimeMs };
            })
                .sort((a, b) => b.createdAtMs - a.createdAtMs);
            return { success: true, backups };
        }
        catch (error) {
            return { success: false, error: toErrorString(error) };
        }
    }
    /**
     * Remove older backups, keeping the most recent `keepCount`.
     */
    async pruneBackups(keepCount = 30) {
        try {
            const list = await this.listBackups();
            if (!list.success)
                return {
                    success: false,
                    ...(list.error != null ? { error: list.error } : {}),
                };
            const backups = list.backups || [];
            const toDelete = backups.slice(keepCount);
            for (const b of toDelete) {
                try {
                    fs.unlinkSync(b.path);
                }
                catch { }
            }
            return { success: true, deleted: toDelete.length };
        }
        catch (error) {
            return { success: false, error: toErrorString(error) };
        }
    }
    /**
     * Verify a backup file using PRAGMA integrity_check.
     */
    async verifyBackup(backupPath) {
        try {
            const backupsDir = this.getBackupsDir();
            const resolved = path.resolve(backupPath);
            const allowedDir = path.resolve(backupsDir) + path.sep;
            if (!resolved.startsWith(allowedDir)) {
                return { success: false, error: "Invalid backup path" };
            }
            if (!resolved.endsWith(".sqlite")) {
                return { success: false, error: "Invalid backup file" };
            }
            if (!fs.existsSync(resolved)) {
                return { success: false, error: "Backup not found" };
            }
            // Dynamic import to avoid bundling issues in some environments
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Database = require("better-sqlite3");
            const db = new Database(resolved, { readonly: true });
            try {
                const row = db.prepare("PRAGMA integrity_check").get();
                const ok = row?.integrity_check === "ok";
                return { success: true, ok };
            }
            finally {
                db.close();
            }
        }
        catch (error) {
            return { success: false, error: toErrorString(error) };
        }
    }
    /**
     * Restore the DB from a backup file.
     * Note: caller should quit/relaunch after restore.
     */
    async restoreDatabaseFromBackup(backupPath) {
        try {
            const backupsDir = this.getBackupsDir();
            const resolved = path.resolve(backupPath);
            const allowedDir = path.resolve(backupsDir) + path.sep;
            if (!resolved.startsWith(allowedDir)) {
                return { success: false, error: "Invalid backup path" };
            }
            if (!resolved.endsWith(".sqlite")) {
                return { success: false, error: "Invalid backup file" };
            }
            if (!fs.existsSync(resolved)) {
                return { success: false, error: "Backup not found" };
            }
            const target = this.getDbPath();
            const tmpTarget = target + ".restore_tmp";
            fs.copyFileSync(resolved, tmpTarget);
            fs.copyFileSync(tmpTarget, target);
            try {
                fs.unlinkSync(tmpTarget);
            }
            catch { }
            return { success: true };
        }
        catch (error) {
            return { success: false, error: toErrorString(error) };
        }
    }
}

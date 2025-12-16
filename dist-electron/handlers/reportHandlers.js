"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReportHandlers = registerReportHandlers;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
function registerReportHandlers() {
    electron_1.ipcMain.handle('report:generate-pdf', async (_event, data) => {
        const html = data.html || '<html><body><pre>No content</pre></body></html>';
        const filename = data.filename || `report_${Date.now()}.pdf`;
        // Create hidden window to render HTML
        const win = new electron_1.BrowserWindow({
            show: false,
            webPreferences: {
                offscreen: true
            }
        });
        try {
            // Load the HTML via a data URL
            const dataUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent(html);
            await win.loadURL(dataUrl);
            const pdfBuffer = await win.webContents.printToPDF({
                printBackground: true,
                marginsType: 1,
                pageSize: 'A4',
            });
            const reportsDir = path_1.default.join(electron_1.app.getPath('documents'), 'LiratekReports');
            if (!fs_1.default.existsSync(reportsDir))
                fs_1.default.mkdirSync(reportsDir, { recursive: true });
            const outPath = path_1.default.join(reportsDir, filename);
            fs_1.default.writeFileSync(outPath, pdfBuffer);
            return { success: true, path: outPath };
        }
        catch (error) {
            console.error('Failed to generate PDF report:', error);
            return { success: false, error: error.message };
        }
        finally {
            win.destroy();
        }
    });
    // Backup database to Documents/LiratekBackups
    electron_1.ipcMain.handle('report:backup-db', async () => {
        try {
            const userDataPath = electron_1.app.getPath('userData');
            const dbPath = path_1.default.join(userDataPath, 'phone_shop.db');
            const backupsDir = path_1.default.join(electron_1.app.getPath('documents'), 'LiratekBackups');
            if (!fs_1.default.existsSync(backupsDir))
                fs_1.default.mkdirSync(backupsDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const outPath = path_1.default.join(backupsDir, `backup_${ts}.sqlite`);
            fs_1.default.copyFileSync(dbPath, outPath);
            return { success: true, path: outPath };
        }
        catch (error) {
            console.error('Failed to backup database:', error);
            return { success: false, error: error.message };
        }
    });
}

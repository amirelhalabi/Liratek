import { ipcMain, BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';

export function registerReportHandlers(): void {
  ipcMain.handle('report:generate-pdf', async (_event, data: { html: string; filename?: string }) => {
    const html = data.html || '<html><body><pre>No content</pre></body></html>';
    const filename = data.filename || `report_${Date.now()}.pdf`;

    // Create hidden window to render HTML
    const win = new BrowserWindow({
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

      const reportsDir = path.join(app.getPath('documents'), 'LiratekReports');
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

      const outPath = path.join(reportsDir, filename);
      fs.writeFileSync(outPath, pdfBuffer);

      return { success: true, path: outPath };
    } catch (error: any) {
      console.error('Failed to generate PDF report:', error);
      return { success: false, error: error.message };
    } finally {
      win.destroy();
    }
  });

  // Backup database to Documents/LiratekBackups
  ipcMain.handle('report:backup-db', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'phone_shop.db');
      const backupsDir = path.join(app.getPath('documents'), 'LiratekBackups');
      if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outPath = path.join(backupsDir, `backup_${ts}.sqlite`);
      fs.copyFileSync(dbPath, outPath);
      return { success: true, path: outPath };
    } catch (error: any) {
      console.error('Failed to backup database:', error);
      return { success: false, error: error.message };
    }
  });
}

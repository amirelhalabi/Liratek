import { BrowserWindow, app } from "electron";
import path from "path";
import fs from "fs";
import { toErrorString } from "../utils/errors";

export interface GeneratePdfResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface BackupResult {
  success: boolean;
  path?: string;
  error?: string;
}

export class ReportService {
  /**
   * Generate a PDF from HTML content
   */
  async generatePdf(
    html: string,
    filename?: string,
  ): Promise<GeneratePdfResult> {
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
      const dataUrl =
        "data:text/html;charset=UTF-8," + encodeURIComponent(content);
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
    } catch (error) {
      console.error("Failed to generate PDF report:", error);
      return { success: false, error: toErrorString(error) };
    } finally {
      win.destroy();
    }
  }

  /**
   * Backup the database to Documents/LiratekBackups
   */
  async backupDatabase(): Promise<BackupResult> {
    try {
      const userDataPath = app.getPath("userData");
      const dbPath = path.join(userDataPath, "phone_shop.db");
      const backupsDir = path.join(app.getPath("documents"), "LiratekBackups");

      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath = path.join(backupsDir, `backup_${ts}.sqlite`);
      fs.copyFileSync(dbPath, outPath);

      return { success: true, path: outPath };
    } catch (error) {
      console.error("Failed to backup database:", error);
      return { success: false, error: toErrorString(error) };
    }
  }
}

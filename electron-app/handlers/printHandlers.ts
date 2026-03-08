import { ipcMain, BrowserWindow } from "electron";
import { logger } from "@liratek/core";

export function registerPrintHandlers(): void {
  // Get all available printers
  ipcMain.handle("print:get-printers", async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return [];
      const printers = await win.webContents.getPrintersAsync();
      return printers;
    } catch (err) {
      logger.error({ error: err }, "Failed to get printers");
      return [];
    }
  });

  // Print HTML silently to a specific printer
  ipcMain.handle(
    "print:silent",
    async (_event, html: string, printerName: string, options: any = {}) => {
      return new Promise((resolve, reject) => {
        // Create a hidden window to render the HTML
        let printWindow: BrowserWindow | null = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        printWindow.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        );

        printWindow.webContents.on("did-finish-load", () => {
          printWindow?.webContents.print(
            {
              silent: true,
              deviceName: printerName,
              ...options,
            },
            (success, failureReason) => {
              if (!success) {
                logger.error(
                  { failureReason, printerName },
                  "Silent print failed",
                );
                resolve({ success: false, error: failureReason });
              } else {
                logger.info({ printerName }, "Silent print success");
                resolve({ success: true });
              }

              // Cleanup
              if (printWindow) {
                printWindow.close();
                printWindow = null;
              }
            },
          );
        });

        printWindow.webContents.on(
          "did-fail-load",
          (e, errorCode, errorDescription) => {
            logger.error(
              { errorCode, errorDescription },
              "Failed to load print html",
            );
            resolve({ success: false, error: errorDescription });
            if (printWindow) {
              printWindow.close();
              printWindow = null;
            }
          },
        );
      });
    },
  );
}

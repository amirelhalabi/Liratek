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

  // Print HTML via the native OS dialog. Identical recipe to print:silent
  // (a hidden BrowserWindow loaded via loadURL, never
  // window.open()+document.write() from the renderer — renderer-initiated
  // `window.open("data:...")` is blocked by Chromium as a top-frame data:
  // URL navigation) — the ONLY difference is `silent: false` so the native
  // OS print dialog is shown instead of printing straight to a printer.
  // A second VISIBLE app window was tried here first (matching the user's
  // ask to see an in-app preview) but reliably broke the running app window
  // in this Electron setup (observed: main window closing/reloading) no
  // matter how the window was populated — so this stays hidden like the
  // silent path; the OS print dialog renders its own preview of the loaded
  // page regardless of whether the source window is shown.
  ipcMain.handle("print:with-dialog", async (_event, html: string) => {
    return new Promise((resolve) => {
      let printWindow: BrowserWindow | null = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      const cleanup = (result: { success: boolean; error?: string }): void => {
        if (printWindow) {
          printWindow.close();
          printWindow = null;
        }
        resolve(result);
      };

      printWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      );

      printWindow.webContents.on("did-finish-load", () => {
        printWindow?.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            if (!success) {
              logger.info(
                { failureReason },
                "Receipt print dialog closed without printing",
              );
            }
            cleanup({ success });
          },
        );
      });

      printWindow.webContents.on(
        "did-fail-load",
        (e, errorCode, errorDescription) => {
          logger.error(
            { errorCode, errorDescription },
            "Failed to load print-with-dialog html",
          );
          cleanup({ success: false, error: errorDescription });
        },
      );
    });
  });
}

import { app, BrowserWindow, dialog } from "electron";
import path from "path";
import { purgeExpiredSessions } from "./session";
import { runMigrations } from "./db/migrate";
import { registerDatabaseHandlers } from "./handlers/dbHandlers";
import { registerAuthHandlers } from "./handlers/authHandlers";
import { registerInventoryHandlers } from "./handlers/inventoryHandlers";
import { registerClientHandlers } from "./handlers/clientHandlers";
import { registerSalesHandlers } from "./handlers/salesHandlers";
import { registerDebtHandlers } from "./handlers/debtHandlers";
import { registerExchangeHandlers } from "./handlers/exchangeHandlers";
import { registerOMTHandlers } from "./handlers/omtHandlers";
import { registerRechargeHandlers } from "./handlers/rechargeHandlers";
import { registerMaintenanceHandlers } from "./handlers/maintenanceHandlers";
import { registerReportHandlers } from "./handlers/reportHandlers";
import { registerCurrencyHandlers } from "./handlers/currencyHandlers";
import { registerRateHandlers } from "./handlers/rateHandlers";
import { startSyncProcessor } from "./sync";

// Ensure consistent app name in dev (macOS Dock/menu often shows "Electron" otherwise)
app.setName("LiraTek");

// ============================================================================
// SINGLE INSTANCE LOCK
// ============================================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  process.on("uncaughtException", (error: unknown) => {
    console.error("Uncaught Exception:", error);

    const err = error instanceof Error ? error : new Error(String(error));

    try {
      dialog.showErrorBox(
        "A JavaScript error occurred in the main process",
        err.stack || err.message,
      );
    } catch (e) {
      console.error("Failed to show error box:", e);
    }

    app.quit();
  });

  app.on("second-instance", () => {
    console.log(
      "[SingleInstance] Attempted to open second instance. Focusing existing window.",
    );

    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const mainWindow = windows[0];

      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.focus();

      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "LiraTek Already Running",
        message: "LiraTek is already running!",
        detail:
          "Only one instance of LiraTek can run at a time. The existing window has been brought to focus.",
        buttons: ["OK"],
      });
    }
  });

  // Handle creating/removing shortcuts on Windows when installing/uninstalling.
  if (process.platform === "win32") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const squirrelStartup = require("electron-squirrel-startup");
      if (squirrelStartup) {
        app.quit();
      }
    } catch (e) {
      console.error("Squirrel startup error:", e);
    }
  }

  const createWindow = () => {
    const iconPath = path.join(__dirname, "../resources/icon.png");

    const mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      ...(process.platform !== "darwin" && !app.isPackaged && { icon: iconPath }),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
      mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
      mainWindow.webContents.openDevTools();
    } else {
      const indexPath = path.join(__dirname, "../dist/index.html");
      mainWindow.loadFile(indexPath).catch((e) => {
        console.error("Failed to load index.html:", e);
        dialog.showErrorBox(
          "Startup Error",
          `Failed to load application files.\nPath: ${indexPath}\nError: ${e.message}`,
        );
      });
    }
  };

  app.whenReady().then(() => {
    // Some platforms (macOS) may ignore early setName; set again when ready.
    app.setName("LiraTek");

    if (process.platform === "darwin" && app.dock && !app.isPackaged) {
      const iconPath = path.join(__dirname, "../resources/icon.png");
      app.dock.setIcon(iconPath);
    }

    try {
      console.log("Initializing database...");
      runMigrations();
      console.log("Database ready");

      registerDatabaseHandlers();
      registerAuthHandlers();
      registerInventoryHandlers();
      registerClientHandlers();
      registerSalesHandlers();
      registerDebtHandlers();
      registerExchangeHandlers();
      registerOMTHandlers();
      registerRechargeHandlers();
      registerMaintenanceHandlers();
      registerReportHandlers();
      registerCurrencyHandlers();
      registerRateHandlers();

      startSyncProcessor();

      setInterval(() => purgeExpiredSessions(Date.now()), 60 * 1000);

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { autoUpdater } = require("electron-updater");
        autoUpdater.checkForUpdatesAndNotify();
      } catch (_e) {
        console.log("[Updater] Skipped (module not installed)");
      }

      createWindow();
    } catch (error: unknown) {
      console.error("Failed to start app:", error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : String(error);
      dialog.showErrorBox(
        "Initialization Error",
        "Failed to initialize the application: " + message,
      );
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

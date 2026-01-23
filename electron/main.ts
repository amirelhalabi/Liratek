import { app, BrowserWindow, dialog } from "electron";
import path from "path";
import { purgeExpiredSessions } from "./session";
import { runMigrations } from "./db/migrate";
import { registerDatabaseHandlers } from "./handlers/dbHandlers";
import { registerAuthHandlers } from "./handlers/authHandlers";
import { registerInventoryHandlers } from "./handlers/inventoryHandlers";
import { registerSupplierHandlers } from "./handlers/supplierHandlers";
import { registerClientHandlers } from "./handlers/clientHandlers";
import { registerSalesHandlers } from "./handlers/salesHandlers";
import { registerDebtHandlers } from "./handlers/debtHandlers";
import { registerExchangeHandlers } from "./handlers/exchangeHandlers";
import { registerOMTHandlers } from "./handlers/omtHandlers";
import { registerRechargeHandlers } from "./handlers/rechargeHandlers";
import { registerMaintenanceHandlers } from "./handlers/maintenanceHandlers";
import { registerReportHandlers } from "./handlers/reportHandlers";
import { registerCurrencyHandlers } from "./handlers/currencyHandlers";
import { getSettingsService } from "./services/SettingsService";
import { ReportService } from "./services/ReportService";
import { registerRateHandlers } from "./handlers/rateHandlers";
import { registerFinancialHandlers } from "./handlers/financialHandlers";
import { registerUpdaterHandlers } from "./handlers/updaterHandlers";
import { startSyncProcessor } from "./sync";

// ============================================================================
// SINGLE INSTANCE LOCK
// ============================================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one immediately
  app.quit();
} else {
  // Global error handler
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

  // This is the first instance, set up the handler for when someone tries to open a second instance
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
      ...(process.platform !== "darwin" &&
        !app.isPackaged && { icon: iconPath }),
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
      registerSupplierHandlers();
      registerFinancialHandlers();
      registerUpdaterHandlers();

      startSyncProcessor();

      setInterval(() => purgeExpiredSessions(Date.now()), 60 * 1000);

      // ---------------------------------------------------------------------
      // Auto backup scheduler (P2)
      // Settings keys:
      //  - auto_backup_enabled: 1/0 (default 1)
      //  - auto_backup_interval_hours: number (default 24)
      //  - auto_backup_keep_count: number (default 30)
      // ---------------------------------------------------------------------
      try {
        const settings = getSettingsService();
        const reportService = new ReportService();

        const readConfig = () => {
          const enabled =
            Number(settings.getSettingValue("auto_backup_enabled")?.value ?? 1) ===
            1;
          const intervalHours = Number(
            settings.getSettingValue("auto_backup_interval_hours")?.value ?? 24,
          );
          const keepCount = Number(
            settings.getSettingValue("auto_backup_keep_count")?.value ?? 30,
          );

          return {
            enabled,
            intervalMs:
              isFinite(intervalHours) && intervalHours > 0
                ? intervalHours * 60 * 60 * 1000
                : 24 * 60 * 60 * 1000,
            keepCount:
              isFinite(keepCount) && keepCount > 0 ? keepCount : 30,
          };
        };

        const runOnce = async () => {
          const cfg = readConfig();
          if (!cfg.enabled) return;

          const backupRes = await reportService.backupDatabase();
          if (!backupRes.success) {
            console.error("[AutoBackup] Backup failed:", backupRes.error);
            return;
          }

          try {
            settings.updateSetting("last_backup_at", new Date().toISOString());
          } catch { }

          // optional auto-verify
          try {
            const verifyEnabled =
              Number(settings.getSettingValue("auto_backup_verify_enabled")?.value ?? 0) ===
              1;
            if (verifyEnabled && backupRes.path) {
              const v = await reportService.verifyBackup(backupRes.path);
              settings.updateSetting("last_backup_verify_at", new Date().toISOString());
              settings.updateSetting("last_backup_verify_ok", v.ok ? "1" : "0");
            }
          } catch { }

          const pruneRes = await reportService.pruneBackups(cfg.keepCount);
          if (!pruneRes.success) {
            console.error("[AutoBackup] Prune failed:", pruneRes.error);
          }
        };

        // schedule repeating job
        const cfg = readConfig();
        setInterval(() => {
          void runOnce();
        }, cfg.intervalMs);

        // kick off an initial run shortly after startup
        setTimeout(() => {
          void runOnce();
        }, 30 * 1000);
      } catch (e) {
        console.error("[AutoBackup] Scheduler init failed:", e);
      }

      try {
        if (app.isPackaged) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { autoUpdater } = require("electron-updater");
          autoUpdater.checkForUpdatesAndNotify();
        } else {
          console.log("[Updater] Skipped (dev mode)");
        }
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

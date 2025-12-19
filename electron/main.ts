import { app, BrowserWindow, dialog } from "electron";
import { purgeExpiredSessions } from "./session";
import path from "path";
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

// ============================================================================
// SINGLE INSTANCE LOCK
// ============================================================================
// Prevent multiple instances of the app from running simultaneously
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one immediately
  console.log("[SingleInstance] Another instance is already running. Quitting.");
  app.quit();
} else {
  // This is the first instance, set up the handler for when someone tries to open a second instance
  app.on("second-instance", () => {
    console.log("[SingleInstance] Attempted to open second instance. Focusing existing window.");
    
    // Someone tried to run a second instance, we should focus our window.
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const mainWindow = windows[0];
      
      // If window is minimized, restore it
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      
      // Focus the window
      mainWindow.focus();
      
      // Optional: Show a dialog to inform the user
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "LiraTek Already Running",
        message: "LiraTek is already running!",
        detail: "Only one instance of LiraTek can run at a time. The existing window has been brought to focus.",
        buttons: ["OK"]
      });
    }
  });
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === "win32") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const squirrelStartup = require("electron-squirrel-startup");
  if (squirrelStartup) {
    app.quit();
  }
}

function createWindow() {
  // Icon path for development (not needed in packaged macOS app)
  const iconPath = path.join(__dirname, "../resources/icon.png");
  
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Only set icon on non-macOS or development (macOS uses .icns from bundle)
    ...(process.platform !== "darwin" && !app.isPackaged && { icon: iconPath }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the local URL for development or the local file for production.
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  // Set app name for macOS dock
  app.setName("LiraTek");
  
  // Set dock icon on macOS (only in development, packaged app uses .icns)
  if (process.platform === "darwin" && app.dock && !app.isPackaged) {
    const iconPath = path.join(__dirname, "../resources/icon.png");
    app.dock.setIcon(iconPath);
  }

  // Initialize database and run migrations
  console.log("Initializing database...");
  runMigrations();
  console.log("Database ready");

  // Register IPC handlers
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

  // Start sync processor (Phase 6)
  startSyncProcessor();

  // Session timeout purge
  setInterval(() => purgeExpiredSessions(Date.now()), 60 * 1000);

  // Auto-updater (scaffold)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify();
  } catch (_e) {
    console.log("[Updater] Skipped (module not installed)");
  }

  createWindow();

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

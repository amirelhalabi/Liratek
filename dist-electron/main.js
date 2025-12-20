"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const session_1 = require("./session");
const path_1 = __importDefault(require("path"));
const migrate_1 = require("./db/migrate");
const dbHandlers_1 = require("./handlers/dbHandlers");
const authHandlers_1 = require("./handlers/authHandlers");
const inventoryHandlers_1 = require("./handlers/inventoryHandlers");
const clientHandlers_1 = require("./handlers/clientHandlers");
const salesHandlers_1 = require("./handlers/salesHandlers");
const debtHandlers_1 = require("./handlers/debtHandlers");
const exchangeHandlers_1 = require("./handlers/exchangeHandlers");
const omtHandlers_1 = require("./handlers/omtHandlers");
const rechargeHandlers_1 = require("./handlers/rechargeHandlers");
const maintenanceHandlers_1 = require("./handlers/maintenanceHandlers");
const reportHandlers_1 = require("./handlers/reportHandlers");
const currencyHandlers_1 = require("./handlers/currencyHandlers");
const rateHandlers_1 = require("./handlers/rateHandlers");
const sync_1 = require("./sync");
// ============================================================================
// SINGLE INSTANCE LOCK
// ============================================================================
// Prevent multiple instances of the app from running simultaneously
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    // Another instance is already running, quit this one immediately
    console.log("[SingleInstance] Another instance is already running. Quitting.");
    electron_1.app.quit();
}
else {
    // This is the first instance, set up the handler for when someone tries to open a second instance
    electron_1.app.on("second-instance", () => {
        console.log("[SingleInstance] Attempted to open second instance. Focusing existing window.");
        // Someone tried to run a second instance, we should focus our window.
        const windows = electron_1.BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            const mainWindow = windows[0];
            // If window is minimized, restore it
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            // Focus the window
            mainWindow.focus();
            // Optional: Show a dialog to inform the user
            electron_1.dialog.showMessageBox(mainWindow, {
                type: "info",
                title: "LiraTek Already Running",
                message: "LiraTek is already running!",
                detail: "Only one instance of LiraTek can run at a time. The existing window has been brought to focus.",
                buttons: ["OK"],
            });
        }
    });
}
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === "win32") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const squirrelStartup = require("electron-squirrel-startup");
    if (squirrelStartup) {
        electron_1.app.quit();
    }
}
function createWindow() {
    // Icon path for development (not needed in packaged macOS app)
    const iconPath = path_1.default.join(__dirname, "../resources/icon.png");
    const mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        // Only set icon on non-macOS or development (macOS uses .icns from bundle)
        ...(process.platform !== "darwin" && !electron_1.app.isPackaged && { icon: iconPath }),
        webPreferences: {
            preload: path_1.default.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    // Load the local URL for development or the local file for production.
    if (!electron_1.app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
        mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, "../dist/index.html"));
    }
}
electron_1.app.whenReady().then(() => {
    // Set app name for macOS dock
    electron_1.app.setName("LiraTek");
    // Set dock icon on macOS (only in development, packaged app uses .icns)
    if (process.platform === "darwin" && electron_1.app.dock && !electron_1.app.isPackaged) {
        const iconPath = path_1.default.join(__dirname, "../resources/icon.png");
        electron_1.app.dock.setIcon(iconPath);
    }
    // Initialize database and run migrations
    console.log("Initializing database...");
    (0, migrate_1.runMigrations)();
    console.log("Database ready");
    // Register IPC handlers
    (0, dbHandlers_1.registerDatabaseHandlers)();
    (0, authHandlers_1.registerAuthHandlers)();
    (0, inventoryHandlers_1.registerInventoryHandlers)();
    (0, clientHandlers_1.registerClientHandlers)();
    (0, salesHandlers_1.registerSalesHandlers)();
    (0, debtHandlers_1.registerDebtHandlers)();
    (0, exchangeHandlers_1.registerExchangeHandlers)();
    (0, omtHandlers_1.registerOMTHandlers)();
    (0, rechargeHandlers_1.registerRechargeHandlers)();
    (0, maintenanceHandlers_1.registerMaintenanceHandlers)();
    (0, reportHandlers_1.registerReportHandlers)();
    (0, currencyHandlers_1.registerCurrencyHandlers)();
    (0, rateHandlers_1.registerRateHandlers)();
    // Start sync processor (Phase 6)
    (0, sync_1.startSyncProcessor)();
    // Session timeout purge
    setInterval(() => (0, session_1.purgeExpiredSessions)(Date.now()), 60 * 1000);
    // Auto-updater (scaffold)
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { autoUpdater } = require("electron-updater");
        autoUpdater.checkForUpdatesAndNotify();
    }
    catch (_e) {
        console.log("[Updater] Skipped (module not installed)");
    }
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});

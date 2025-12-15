"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
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
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require('electron-squirrel-startup')) {
    electron_1.app.quit();
}
function createWindow() {
    const mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    // Load the local URL for development or the local file for production.
    if (!electron_1.app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
}
electron_1.app.whenReady().then(() => {
    // Initialize database and run migrations
    console.log('Initializing database...');
    (0, migrate_1.runMigrations)();
    console.log('Database ready');
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
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});

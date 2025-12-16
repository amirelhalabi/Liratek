
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { runMigrations } from './db/migrate';
import { registerDatabaseHandlers } from './handlers/dbHandlers';
import { registerAuthHandlers } from './handlers/authHandlers';
import { registerInventoryHandlers } from './handlers/inventoryHandlers';
import { registerClientHandlers } from './handlers/clientHandlers';
import { registerSalesHandlers } from './handlers/salesHandlers';
import { registerDebtHandlers } from './handlers/debtHandlers';
import { registerExchangeHandlers } from './handlers/exchangeHandlers';
import { registerOMTHandlers } from './handlers/omtHandlers';
import { registerRechargeHandlers } from './handlers/rechargeHandlers';
import { registerMaintenanceHandlers } from './handlers/maintenanceHandlers';
import { registerReportHandlers } from './handlers/reportHandlers';
import { registerCurrencyHandlers } from './handlers/currencyHandlers';
import { registerRateHandlers } from './handlers/rateHandlers';
import { startSyncProcessor } from './sync';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require('electron-squirrel-startup')) {
    app.quit();
}

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Load the local URL for development or the local file for production.
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    // Initialize database and run migrations
    console.log('Initializing database...');
    runMigrations();
    console.log('Database ready');

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

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
/**
 * Electron Main Process
 * Uses backend services directly (no REST API in Electron mode)
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let db: Database.Database;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Development: Load from Vite dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools();
  } 
  // Production: Load from built files
  else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  console.log('[ELECTRON] App ready, creating window...');
  
  // Initialize database and services
  initializeBackend();
  
  // Register IPC handlers
  await registerHandlers();
  
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

/**
 * Initialize database connection and schema
 */
function initializeDatabase() {
  const userDataPath = app.getPath('userData');
  
  // Try old database location first (from old electron app)
  const oldDbPath = path.join(app.getPath('home'), 'Library/Application Support/liratek/liratek.db');
  const newDbPath = path.join(userDataPath, 'liratek.db');
  
  let dbPath = newDbPath;
  if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
    console.log('[ELECTRON] Found existing database, copying from old location...');
    fs.copyFileSync(oldDbPath, newDbPath);
    dbPath = newDbPath;
  } else if (fs.existsSync(newDbPath)) {
    dbPath = newDbPath;
  } else {
    dbPath = newDbPath;
  }
  
  console.log('[ELECTRON] Database path:', dbPath);
  
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Check if database has schema
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    
    if (!tableCheck) {
      console.log('[ELECTRON] WARNING: Database has no schema! Please use existing database or restore from backup.');
      // For now, just continue - the handlers will initialize what's needed
    } else {
      console.log('[ELECTRON] Database schema OK');
    }
    
    console.log('[ELECTRON] Database connected successfully');
    return db;
  } catch (error) {
    console.error('[ELECTRON] Database connection failed:', error);
    throw error;
  }
}

/**
 * Initialize backend services
 * Services are imported from copied electron/services folder
 */
function initializeBackend() {
  console.log('[ELECTRON] Initializing backend services...');
  
  // Initialize database
  initializeDatabase();
  
  // Services are initialized on-demand by handlers
  // Each service gets the db instance when needed
  
  console.log('[ELECTRON] Backend services initialized');
}

/**
 * Get database instance
 * Used by services and handlers
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

/**
 * Register IPC handlers
 * These connect the frontend (renderer) to backend services
 */
async function registerHandlers() {
  console.log('[ELECTRON] Registering IPC handlers...');
  
  try {
    // Import and register all handlers
    const authHandlers = await import('./handlers/authHandlers.js');
    const clientHandlers = await import('./handlers/clientHandlers.js');
    const currencyHandlers = await import('./handlers/currencyHandlers.js');
    const dbHandlers = await import('./handlers/dbHandlers.js');
    const debtHandlers = await import('./handlers/debtHandlers.js');
    const exchangeHandlers = await import('./handlers/exchangeHandlers.js');
    const financialHandlers = await import('./handlers/financialHandlers.js');
    const inventoryHandlers = await import('./handlers/inventoryHandlers.js');
    const maintenanceHandlers = await import('./handlers/maintenanceHandlers.js');
    const omtHandlers = await import('./handlers/omtHandlers.js');
    const rateHandlers = await import('./handlers/rateHandlers.js');
    const rechargeHandlers = await import('./handlers/rechargeHandlers.js');
    const reportHandlers = await import('./handlers/reportHandlers.js');
    const salesHandlers = await import('./handlers/salesHandlers.js');
    const supplierHandlers = await import('./handlers/supplierHandlers.js');
    const updaterHandlers = await import('./handlers/updaterHandlers.js');
    
    // Register all handlers (they auto-register with ipcMain)
    authHandlers.registerAuthHandlers();
    clientHandlers.registerClientHandlers();
    currencyHandlers.registerCurrencyHandlers();
    dbHandlers.registerDatabaseHandlers();
    debtHandlers.registerDebtHandlers();
    exchangeHandlers.registerExchangeHandlers();
    financialHandlers.registerFinancialHandlers();
    inventoryHandlers.registerInventoryHandlers();
    maintenanceHandlers.registerMaintenanceHandlers();
    omtHandlers.registerOMTHandlers();
    rateHandlers.registerRateHandlers();
    rechargeHandlers.registerRechargeHandlers();
    reportHandlers.registerReportHandlers();
    salesHandlers.registerSalesHandlers();
    supplierHandlers.registerSupplierHandlers();
    updaterHandlers.registerUpdaterHandlers();
    
    console.log('[ELECTRON] All IPC handlers registered');
  } catch (error) {
    console.error('[ELECTRON] Failed to register handlers:', error);
    throw error;
  }
}

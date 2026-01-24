/**
 * Electron Main Process
 * Uses backend services directly (no REST API in Electron mode)
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

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
      preload: path.join(__dirname, 'preload.js'),
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

app.whenReady().then(() => {
  console.log('[ELECTRON] App ready, creating window...');
  
  // Initialize database and services
  initializeBackend();
  
  // Register IPC handlers
  registerHandlers();
  
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
 * Initialize backend services
 * In the new structure, backend services are imported directly
 */
function initializeBackend() {
  console.log('[ELECTRON] Initializing backend services...');
  
  // TODO: Import and initialize backend services
  // import { getDatabase } from '../backend/src/database/connection.js';
  // const db = getDatabase();
  
  console.log('[ELECTRON] Backend services initialized');
}

/**
 * Register IPC handlers
 * These connect the frontend (renderer) to backend services
 */
function registerHandlers() {
  console.log('[ELECTRON] Registering IPC handlers...');
  
  // Example: Ping handler
  ipcMain.handle('ping', () => {
    return 'pong';
  });
  
  // TODO: Import and register all backend handlers
  // import { registerAuthHandlers } from '../backend/src/handlers/authHandlers.js';
  // registerAuthHandlers(ipcMain);
  
  console.log('[ELECTRON] IPC handlers registered');
}

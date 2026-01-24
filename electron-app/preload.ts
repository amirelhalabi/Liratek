/**
 * Electron Preload Script
 * Creates the window.api bridge between renderer and main process
 */

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('api', {
  // Example API
  ping: () => ipcRenderer.invoke('ping'),
  
  // Auth API
  login: (username: string, password: string) => 
    ipcRenderer.invoke('auth:login', { username, password }),
  logout: (userId: number) => 
    ipcRenderer.invoke('auth:logout', { userId }),
  restoreSession: () => 
    ipcRenderer.invoke('auth:restore-session'),
  
  // Settings API
  settings: {
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', { key, value }),
  },
  
  // Closing API
  closing: {
    getSystemExpectedBalances: () => ipcRenderer.invoke('closing:get-system-expected-balances'),
    hasOpeningBalanceToday: () => ipcRenderer.invoke('closing:has-opening-balance-today'),
    getDailyStatsSnapshot: () => ipcRenderer.invoke('closing:get-daily-stats-snapshot'),
    setOpeningBalances: (data: any) => ipcRenderer.invoke('closing:set-opening-balances', data),
    createDailyClosing: (data: any) => ipcRenderer.invoke('closing:create-daily-closing', data),
    updateDailyClosing: (data: any) => ipcRenderer.invoke('closing:update-daily-closing', data),
  },
  
  // Rates API
  rates: {
    list: () => ipcRenderer.invoke('rates:list'),
    set: (from: string, to: string, rate: number) => 
      ipcRenderer.invoke('rates:set', { from, to, rate }),
  },
  
  // Activity API
  activity: {
    getRecent: (limit: number) => ipcRenderer.invoke('activity:get-recent', { limit }),
  },
  
  // Report API
  report: {
    generatePDF: (html: string, filename: string) => 
      ipcRenderer.invoke('report:generate-pdf', { html, filename }),
  },
  
  // TODO: Add more API endpoints as needed
  // - Clients
  // - Inventory
  // - Sales
  // - Debts
  // - Exchange
  // - Expenses
  // - Recharge
  // - Services
  // - Maintenance
  // - Currencies
  // - Suppliers
  // - Users
});

// Electron environment flag
contextBridge.exposeInMainWorld('isElectron', true);

console.log('[PRELOAD] API bridge created');

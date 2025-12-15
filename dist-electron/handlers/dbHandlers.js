"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDatabaseHandlers = registerDatabaseHandlers;
const electron_1 = require("electron");
const db_1 = require("../db");
function registerDatabaseHandlers() {
    // Get system settings
    electron_1.ipcMain.handle('db:get-settings', () => {
        const db = (0, db_1.getDatabase)();
        const settings = db.prepare('SELECT * FROM system_settings').all();
        return settings;
    });
    // Get setting by key
    electron_1.ipcMain.handle('db:get-setting', (_event, key) => {
        const db = (0, db_1.getDatabase)();
        const setting = db.prepare('SELECT value FROM system_settings WHERE key_name = ?').get(key);
        return setting;
    });
    // Update setting
    electron_1.ipcMain.handle('db:update-setting', (_event, key, value) => {
        const db = (0, db_1.getDatabase)();
        const stmt = db.prepare(`
      INSERT INTO system_settings (key_name, value) 
      VALUES (?, ?) 
      ON CONFLICT(key_name) 
      DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(key, value, value);
        return { success: true };
    });
}

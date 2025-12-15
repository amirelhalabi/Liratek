import { ipcMain } from 'electron';
import { getDatabase } from '../db';

export function registerDatabaseHandlers(): void {
    // Get system settings
    ipcMain.handle('db:get-settings', () => {
        const db = getDatabase();
        const settings = db.prepare('SELECT * FROM system_settings').all();
        return settings;
    });

    // Get setting by key
    ipcMain.handle('db:get-setting', (_event, key: string) => {
        const db = getDatabase();
        const setting = db.prepare('SELECT value FROM system_settings WHERE key_name = ?').get(key);
        return setting;
    });

    // Update setting
    ipcMain.handle('db:update-setting', (_event, key: string, value: string) => {
        const db = getDatabase();
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

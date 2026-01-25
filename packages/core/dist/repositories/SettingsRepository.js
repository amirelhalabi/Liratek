import { getDatabase } from "../db/connection.js";
/**
 * Repository for system_settings table
 * Does not extend BaseRepository since it uses key_name as the primary identifier
 */
export class SettingsRepository {
    db;
    constructor() {
        this.db = getDatabase();
    }
    /**
     * Get all settings
     */
    getAllSettings() {
        return this.db
            .prepare("SELECT * FROM system_settings")
            .all();
    }
    /**
     * Get a setting by key
     */
    getSetting(key) {
        return this.db
            .prepare("SELECT * FROM system_settings WHERE key_name = ?")
            .get(key);
    }
    /**
     * Get setting value by key
     */
    getSettingValue(key) {
        const setting = this.db
            .prepare("SELECT value FROM system_settings WHERE key_name = ?")
            .get(key);
        return setting?.value;
    }
    /**
     * Upsert a setting (insert or update)
     */
    upsertSetting(key, value) {
        const stmt = this.db.prepare(`
      INSERT INTO system_settings (key_name, value)
      VALUES (?, ?)
      ON CONFLICT(key_name)
      DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(key, value, value);
    }
}
// Singleton instance
let settingsRepositoryInstance = null;
export function getSettingsRepository() {
    if (!settingsRepositoryInstance) {
        settingsRepositoryInstance = new SettingsRepository();
    }
    return settingsRepositoryInstance;
}
export function resetSettingsRepository() {
    settingsRepositoryInstance = null;
}

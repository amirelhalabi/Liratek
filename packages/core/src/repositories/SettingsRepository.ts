import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export interface SettingEntity {
  id?: number;
  key_name: string;
  value: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Repository for system_settings table
 * Does not extend BaseRepository since it uses key_name as the primary identifier
 */
export class SettingsRepository {
  protected db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Get all settings
   */
  getAllSettings(): SettingEntity[] {
    return this.db
      .prepare("SELECT * FROM system_settings")
      .all() as SettingEntity[];
  }

  /**
   * Get a setting by key
   */
  getSetting(key: string): SettingEntity | undefined {
    return this.db
      .prepare("SELECT * FROM system_settings WHERE key_name = ?")
      .get(key) as SettingEntity | undefined;
  }

  /**
   * Get setting value by key
   */
  getSettingValue(key: string): string | undefined {
    const setting = this.db
      .prepare("SELECT value FROM system_settings WHERE key_name = ?")
      .get(key) as { value: string } | undefined;
    return setting?.value;
  }

  /**
   * Upsert a setting (insert or update)
   */
  upsertSetting(key: string, value: string): void {
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
let settingsRepositoryInstance: SettingsRepository | null = null;

export function getSettingsRepository(): SettingsRepository {
  if (!settingsRepositoryInstance) {
    settingsRepositoryInstance = new SettingsRepository();
  }
  return settingsRepositoryInstance;
}

export function resetSettingsRepository(): void {
  settingsRepositoryInstance = null;
}

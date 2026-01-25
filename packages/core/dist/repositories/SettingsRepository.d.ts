import type Database from "better-sqlite3";
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
export declare class SettingsRepository {
    protected db: Database.Database;
    constructor();
    /**
     * Get all settings
     */
    getAllSettings(): SettingEntity[];
    /**
     * Get a setting by key
     */
    getSetting(key: string): SettingEntity | undefined;
    /**
     * Get setting value by key
     */
    getSettingValue(key: string): string | undefined;
    /**
     * Upsert a setting (insert or update)
     */
    upsertSetting(key: string, value: string): void;
}
export declare function getSettingsRepository(): SettingsRepository;
export declare function resetSettingsRepository(): void;

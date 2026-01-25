import { SettingEntity } from "../repositories/SettingsRepository.js";
export interface SettingResult {
    success: boolean;
    error?: string;
}
export declare class SettingsService {
    private repo;
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
    getSettingValue(key: string): {
        value: string;
    } | undefined;
    /**
     * Update a setting (upsert)
     */
    updateSetting(key: string, value: string): SettingResult;
}
export declare function getSettingsService(): SettingsService;
export declare function resetSettingsService(): void;
